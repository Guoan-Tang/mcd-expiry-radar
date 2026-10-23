import express, { type ErrorRequestHandler } from 'express';
import { MCP_ENDPOINT, type Config } from './config.js';
import { demoSnapshot } from './demo.js';
import { AppError, safeError } from './errors.js';
import { createCalendar } from './ics.js';
import { loadLive } from './mcp.js';
import { record } from './parse.js';
import type { Snapshot } from '../shared/model.js';

export function createApp(config: Config, liveLoader = loadLive, development = false) {
  const app = express();
  app.disable('x-powered-by');
  const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  const origins = new Set([...hosts].map((host) => `http://${host}`));
  const snapshots = new Map<string, { data: Snapshot; expires: number; timer: NodeJS.Timeout }>();
  let busy = false;
  let lastAttempt = 0;

  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': [
        "default-src 'self'", `script-src 'self'${development ? " 'unsafe-inline'" : ''}`,
        `style-src 'self'${development ? " 'unsafe-inline'" : ''}`,
        "img-src 'self' data:", `connect-src 'self'${development ? ' ws://127.0.0.1:* ws://localhost:*' : ''}`,
        "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'", "object-src 'none'",
      ].join('; '),
    });
    // A link from another app may open the public shell, never a cross-site API response.
    const navigation = req.method === 'GET' && !req.path.startsWith('/api') &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (!req.headers.host || !hosts.has(req.headers.host) ||
        (!navigation && (req.headers['sec-fetch-site'] === 'cross-site' ||
        (req.headers.origin && !origins.has(req.headers.origin))))) {
      res.status(403).json({ code: 'ORIGIN_BLOCKED', message: '仅允许本机同源访问。' });
      return;
    }
    next();
  });

  app.get('/api/config', (_req, res) => {
    res.json({ liveAvailable: Boolean(config.token), endpoint: MCP_ENDPOINT });
  });
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST' || !req.headers.origin || !origins.has(req.headers.origin) ||
        req.headers['x-radar-request'] !== '1' || !req.is('application/json')) {
      res.status(403).json({ code: 'REQUEST_BLOCKED', message: '请从本地网页发起同源 JSON 请求。' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '8kb', strict: true }));

  app.post('/api/snapshot', async (req, res) => {
    if (!record(req.body) || !['live', 'demo'].includes(String(req.body.mode)) ||
        Object.keys(req.body).some((key) => key !== 'mode')) {
      throw new AppError('MODE_REQUIRED', '必须明确选择 demo 或 live；不接受工具名或其他参数。', 400);
    }
    const mode = req.body.mode;
    let data: Snapshot;
    if (mode === 'demo') {
      data = demoSnapshot();
    } else {
      if (!config.token) throw new AppError('TOKEN_MISSING', '本机未配置 MCD_MCP_TOKEN。请在本地 .env 设置后重启，勿在聊天或网页中输入。', 503);
      if (busy || Date.now() - lastAttempt < 30_000) {
        throw new AppError('LOCAL_RATE_LIMIT', '真实查询至少间隔 30 秒，请稍后刷新。', 429);
      }
      busy = true;
      lastAttempt = Date.now();
      try {
        data = await liveLoader(config.token);
      } finally {
        busy = false;
      }
    }
    for (const [id, entry] of snapshots) {
      if (entry.expires <= Date.now()) { clearTimeout(entry.timer); snapshots.delete(id); }
    }
    if (snapshots.size >= 20) {
      const oldest = snapshots.keys().next().value!;
      clearTimeout(snapshots.get(oldest)!.timer);
      snapshots.delete(oldest);
    }
    const timer = setTimeout(() => snapshots.delete(data.id), 15 * 60_000);
    timer.unref();
    snapshots.set(data.id, { data, expires: Date.now() + 15 * 60_000, timer });
    res.json(data);
  });

  app.post('/api/calendar', (req, res) => {
    if (!record(req.body) || typeof req.body.snapshotId !== 'string' ||
        !Array.isArray(req.body.ids) || !req.body.ids.every((id) => typeof id === 'string') ||
        Object.keys(req.body).some((key) => !['snapshotId', 'ids'].includes(key))) {
      throw new AppError('SELECTION_INVALID', '日历请求格式无效。', 400);
    }
    const entry = snapshots.get(req.body.snapshotId);
    if (!entry || entry.expires <= Date.now()) throw new AppError('SNAPSHOT_EXPIRED', '查询快照已过期，请刷新并重新选择。', 409);
    const calendar = createCalendar(entry.data, req.body.ids);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="mcd-radar-${entry.data.mode}.ics"`,
    }).send(calendar);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND', message: '没有此接口。' });
  });
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const invalidBody = record(error) && ['entity.parse.failed', 'entity.too.large'].includes(String(error.type));
    const safe = invalidBody ? new AppError('BODY_INVALID', '请求体不是合法 JSON 或超过大小限制。', 400) : safeError(error);
    console.warn(`[${safe.code}] ${safe.message}`);
    res.status(safe.status).json({ code: safe.code, message: safe.message });
  };
  app.use(onError);
  return app;
}
