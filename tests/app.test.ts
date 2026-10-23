import { createServer, request as httpRequest, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { readConfig } from '../src/server/config.js';
import { demoSnapshot } from '../src/server/demo.js';
import { AppError } from '../src/server/errors.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup(token?: string, loader = vi.fn(async () => ({ ...demoSnapshot(), mode: 'live' as const }))) {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  server.on('request', createApp({ port: address.port, token }, loader));
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { Host: `127.0.0.1:${address.port}`, Origin: url, 'X-Radar-Request': '1', 'Content-Type': 'application/json' };
  const request = (path: string, body: object) => fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { url, headers, request, loader };
}

describe('local HTTP boundary and mode isolation', () => {
  it('demo is explicit and does not call MCP even when token exists', async () => {
    const { request, loader } = await setup('SYNTHETIC_SECRET');
    const response = await request('/api/snapshot', { mode: 'demo' });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.mode).toBe('demo');
    expect(loader).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain('SYNTHETIC_SECRET');
  });
  it('never falls back to demo for a missing token', async () => {
    const { request } = await setup();
    const response = await request('/api/snapshot', { mode: 'live' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'TOKEN_MISSING' });
  });
  it('auth failures stay failures and do not expose upstream secrets', async () => {
    const loader = vi.fn(async (): Promise<ReturnType<typeof demoSnapshot>> => { throw new AppError('AUTH_FAILED', '认证失败', 401); });
    const { request } = await setup('SYNTHETIC_SECRET', loader);
    const response = await request('/api/snapshot', { mode: 'live' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'AUTH_FAILED', message: '认证失败' });
  });
  it('requires a mode and rejects arbitrary tool proxy arguments', async () => {
    const { request } = await setup();
    expect((await request('/api/snapshot', {})).status).toBe(400);
    expect((await request('/api/snapshot', { mode: 'demo', tool: 'auto-bind-coupons' })).status).toBe(400);
  });
  it('blocks cross-origin, DNS rebinding, absent Origin and simple requests', async () => {
    const { url, headers } = await setup();
    const cases: Record<string, string>[] = [
      { Origin: 'https://evil.example' }, { Host: 'evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' }, { Origin: '' },
      { 'X-Radar-Request': '' }, { 'Content-Type': 'text/plain' },
    ];
    for (const overrides of cases) {
      // Native HTTP preserves intentionally hostile Host values that fetch may overwrite.
      const response = await new Promise<{ status: number | undefined; cors: unknown }>((resolve, reject) => {
        const request = httpRequest(`${url}/api/snapshot`, {
          method: 'POST', headers: { ...headers, ...overrides },
        }, (response) => {
          response.resume();
          response.on('end', () => resolve({ status: response.statusCode, cors: response.headers['access-control-allow-origin'] }));
        });
        request.on('error', reject);
        request.end('{"mode":"demo"}');
      });
      expect(response.status).toBe(403);
      expect(response.cors).toBeUndefined();
    }
    expect((await fetch(`${url}/api/snapshot`, { method: 'OPTIONS', headers })).status).toBe(403);
    expect((await fetch(`${url}/api/snapshot`, { headers })).status).toBe(403);
  });
  it('returns only safe configuration and applies response headers', async () => {
    const { url, headers } = await setup('SYNTHETIC_SECRET');
    const response = await fetch(`${url}/api/config`, { headers });
    expect(await response.json()).toEqual({ liveAvailable: true, endpoint: 'https://mcp.mcd.cn' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-inline');
  });
  it('permits cross-site top-level navigation to the public shell but never API navigation', async () => {
    const { url, headers } = await setup('SYNTHETIC_SECRET');
    const navigate = (path: string) => new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${url}${path}`, {
        headers: { ...headers, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' },
      }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', reject);
      request.end();
    });
    // This fixture contains no static-file handler, so an allowed shell request falls through to 404.
    expect(await navigate('/')).toBe(404);
    expect(await navigate('/api/config')).toBe(403);
  });
  it('exports only server-snapshot items and rejects forged events', async () => {
    const { request } = await setup();
    const data = await (await request('/api/snapshot', { mode: 'demo' })).json();
    const item = data.items.find((entry: { date: unknown }) => entry.date);
    const response = await request('/api/calendar', { snapshotId: data.id, ids: [item.id] });
    expect(response.headers.get('Content-Type')).toContain('text/calendar');
    expect(await response.text()).toContain('BEGIN:VEVENT');
    expect((await request('/api/calendar', { snapshotId: data.id, ids: ['forged'] })).status).toBe(400);
    expect((await request('/api/calendar', { snapshotId: 'missing', ids: [item.id] })).status).toBe(409);
  });
  it('expires in-memory snapshots after 15 minutes', async () => {
    const { request } = await setup();
    const data = await (await request('/api/snapshot', { mode: 'demo' })).json();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    expect((await request('/api/calendar', { snapshotId: data.id, ids: [data.items[0].id] })).status).toBe(409);
    vi.restoreAllMocks();
  });
  it('limits repeated live queries and rejects oversized or malformed JSON', async () => {
    const { request, url, headers } = await setup('SYNTHETIC_SECRET');
    expect((await request('/api/snapshot', { mode: 'live' })).status).toBe(200);
    expect((await request('/api/snapshot', { mode: 'live' })).status).toBe(429);
    expect((await fetch(`${url}/api/snapshot`, { method: 'POST', headers, body: '{bad' })).status).toBe(400);
    expect((await request('/api/snapshot', { mode: 'demo', excess: 'a'.repeat(9000) })).status).toBe(400);
  });
});

describe('server configuration', () => {
  it('has a fixed endpoint and strict port', () => {
    expect(readConfig({})).toEqual({ port: 3210, token: undefined });
    for (const PORT of ['0', '80', '-1', '70000', '3210abc', 'NaN']) expect(() => readConfig({ PORT })).toThrow('PORT');
  });
  it('does not add Bearer and never echoes invalid secrets', () => {
    for (const token of ['Bearer SYNTHETIC_SECRET', 'SYNTHETIC_SECRET\r\nHeader: bad']) {
      expect(() => readConfig({ MCD_MCP_TOKEN: token })).toThrow('格式无效');
      try { readConfig({ MCD_MCP_TOKEN: token }); } catch (error) { expect(String(error)).not.toContain('SYNTHETIC_SECRET'); }
    }
    expect(readConfig({ MCD_MCP_TOKEN: '  synthetic-token ' }).token).toBe('synthetic-token');
  });
});
