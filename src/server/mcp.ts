import { randomUUID } from 'node:crypto';
import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES, type Snapshot, type SourceReport } from '../shared/model.js';
import { sortItems } from '../shared/dates.js';
import { MCP_ENDPOINT } from './config.js';
import { AppError, safeError } from './errors.js';
import { parseTool, record } from './parse.js';

const options = { timeout: 15_000, maxTotalTimeout: 15_000 };

export type ToolClient = Pick<Client, 'listTools' | 'callTool'>;

export function validateSchema(schema: Record<string, unknown>, value: unknown): boolean {
  if (JSON.stringify(schema).length > 100_000) throw new AppError('SCHEMA_INVALID', '工具 schema 过大，已停止该工具。');
  try {
    const dialect = schema.$schema;
    const Validator = typeof dialect === 'string' && dialect.includes('draft-07') ? Ajv : Ajv2020;
    const ajv = new Validator({ strict: false, allErrors: false, validateFormats: false, logger: false });
    return Boolean(ajv.compile(schema)(value));
  } catch {
    throw new AppError('SCHEMA_INVALID', '工具 schema 不受支持，已停止该工具，未猜测参数。');
  }
}

export function officialFetch(token: string, request: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.href !== `${MCP_ENDPOINT}/`) {
      throw new AppError('ENDPOINT_BLOCKED', '已阻止访问非固定官方 MCP 地址。');
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', token);
    let response: Response;
    try {
      response = await request(url, {
        ...init, headers, redirect: 'manual',
        signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]),
      });
    } catch {
      throw new AppError('NETWORK_ERROR', '无法连接官方 MCP 或请求超时；未切换演示数据。');
    }
    if (response.status >= 300 && response.status < 400) throw new AppError('REDIRECT_BLOCKED', 'MCP 重定向已阻止，Token 不会发送到新地址。');
    if (response.status === 401 || response.status === 403) throw new AppError('AUTH_FAILED', 'MCP 认证失败。请在本机更新 Token 后重启服务。', 401);
    if (response.status === 429) throw new AppError('RATE_LIMITED', '官方服务限流，请稍后手动刷新。', 429);
    if (response.status >= 500) throw new AppError('UPSTREAM_UNAVAILABLE', '官方 MCP 暂不可用，请稍后重试。');
    return response;
  };
}

async function discover(client: ToolClient): Promise<Map<string, Tool>> {
  const tools = new Map<string, Tool>();
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const result = await client.listTools(cursor ? { cursor } : {}, options);
    for (const tool of result.tools) {
      if (TOOL_NAMES.some((name) => name === tool.name)) {
        if (tools.has(tool.name)) throw new AppError('DUPLICATE_TOOL', '工具发现返回重复名称，已停止查询。');
        tools.set(tool.name, tool);
      }
    }
    cursor = result.nextCursor;
    if (!cursor) return tools;
  }
  throw new AppError('DISCOVERY_LIMIT', '工具发现分页超出上限，未开始业务查询。');
}

export async function collectLive(client: ToolClient, secret: string, now = new Date().toISOString()): Promise<Snapshot> {
  const tools = await discover(client);
  const snapshot: Snapshot = {
    id: randomUUID(), mode: 'live', fetchedAt: now, now, clock: 'local', items: [], sources: [],
  };
  for (const name of TOOL_NAMES) {
    const tool = tools.get(name);
    try {
      if (!tool) throw new AppError('TOOL_MISSING', '官方服务没有发现此只读工具。');
      if (!validateSchema(tool.inputSchema, {})) {
        throw new AppError('INPUT_REQUIRED', '该工具需要参数；当前适配器仅在 schema 允许空参数时调用，未编造必填值。');
      }
      const result = await client.callTool({ name, arguments: {} }, undefined, options);
      if (tool.outputSchema && result.isError !== true &&
        (!record(result.structuredContent) || !validateSchema(tool.outputSchema, result.structuredContent))) {
        throw new AppError('OUTPUT_INVALID', '返回内容不符合工具声明的 outputSchema。');
      }
      const parsed = parseTool(name, result, secret);
      snapshot.items.push(...parsed.items);
      snapshot.sources.push(parsed.report);
      if (parsed.now) {
        // A remote time far from this machine could turn old offers into current ones.
        if (Math.abs(Date.parse(parsed.now) - Date.parse(now)) > 5 * 60_000) {
          parsed.report.state = 'partial';
          parsed.report.message = '官方与本机时间相差超过 5 分钟；使用本机时间，请核实系统时钟。';
        } else {
          snapshot.now = parsed.now;
          snapshot.clock = 'official';
        }
      }
    } catch (error) {
      const safe = safeError(error);
      const report: SourceReport = {
        tool: name, state: safe.code === 'UNSUPPORTED_FORMAT' ? 'unsupported' : 'error',
        message: safe.message, code: safe.code,
      };
      snapshot.sources.push(report);
    }
  }
  snapshot.items = sortItems(snapshot.items);
  return snapshot;
}

export async function loadLive(token: string): Promise<Snapshot> {
  const client = new Client({ name: 'mcd-expiry-radar', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT), {
    fetch: officialFetch(token),
    requestInit: { headers: { Authorization: token }, redirect: 'manual' },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  try {
    await client.connect(transport, options);
    return await collectLive(client, token);
  } catch (error) {
    throw safeError(error);
  } finally {
    try {
      await client.close();
    } catch {
      console.warn('[MCP_CLOSE_FAILED] MCP 连接关闭失败。');
    }
  }
}
