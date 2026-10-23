import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { collectLive, officialFetch, validateSchema } from '../src/server/mcp.js';
import { TOOL_NAMES } from '../src/shared/model.js';

const time = '2026-10-23T04:00:00Z';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((fn) => fn())); });

async function fixture(overrides: Partial<Record<string, Partial<Tool>>> = {}, failTool?: string) {
  const server = new Server({ name: 'synthetic-mcp-only', version: '1' }, { capabilities: { tools: {} } });
  const calls: string[] = [];
  const tools = [...TOOL_NAMES, 'auto-bind-coupons', 'mall-create-order', 'draw-lottery'].map((name): Tool => ({
    name, inputSchema: { type: 'object', additionalProperties: false }, ...overrides[name],
  }));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    calls.push(request.params.name);
    if (request.params.name === failTool) return { isError: true, content: [{ type: 'text', text: 'synthetic secret error' }] };
    const data: Record<string, object> = {
      'now-time-info': { now: time },
      'query-my-coupons': { coupons: [{ title: '合成券', expiryDate: '2026-10-24' }] },
      'query-my-account': { expiringPoints: 680 },
      'campaign-calendar': { campaigns: [] },
    };
    return { structuredContent: data[request.params.name], content: [] };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'radar-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(async () => { await client.close(); await server.close(); });
  return { client, calls };
}

describe('MCP protocol with explicitly synthetic server', () => {
  it('discovers real protocol schemas and invokes only the four allowlisted tools', async () => {
    const { client, calls } = await fixture();
    const result = await collectLive(client, 'synthetic-token', time);
    expect(calls).toEqual([...TOOL_NAMES]);
    expect(result.mode).toBe('live');
    expect(result.items).toHaveLength(2);
    expect(result.clock).toBe('official');
    expect(result.sources.find((source) => source.tool === 'campaign-calendar')?.state).toBe('empty');
  });
  it('does not invent newly required input parameters', async () => {
    const { client, calls } = await fixture({
      'query-my-coupons': { inputSchema: { type: 'object', required: ['storeId'], properties: { storeId: { type: 'string' } } } },
    });
    const result = await collectLive(client, 'synthetic-token', time);
    expect(calls).not.toContain('query-my-coupons');
    expect(result.sources.find((source) => source.tool === 'query-my-coupons')?.code).toBe('INPUT_REQUIRED');
  });
  it('detects output schema mismatch', async () => {
    const { client } = await fixture({
      'query-my-account': { outputSchema: { type: 'object', required: ['someFutureField'] } },
    });
    const result = await collectLive(client, 'synthetic-token', time);
    expect(result.sources.find((source) => source.tool === 'query-my-account')?.state).toBe('error');
    expect(result.items.some((item) => item.category === 'points')).toBe(false);
  });
  it('preserves successful categories without success-shaped fallback', async () => {
    const { client } = await fixture({}, 'query-my-coupons');
    const result = await collectLive(client, 'synthetic-token', time);
    expect(result.sources.find((source) => source.tool === 'query-my-coupons')?.state).toBe('error');
    expect(result.items.some((item) => item.category === 'coupon')).toBe(false);
    expect(result.items.some((item) => item.category === 'points')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('synthetic secret error');
  });
  it('reports clock drift and explicitly keeps local time', async () => {
    const { client } = await fixture();
    const result = await collectLive(client, 'synthetic-token', '2026-10-23T05:00:00Z');
    expect(result.clock).toBe('local');
    expect(result.now).toBe('2026-10-23T05:00:00Z');
  });
});

describe('official HTTP boundary', () => {
  it('sends raw Authorization, never Bearer, and disables redirects', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('{}'));
    await officialFetch('synthetic-token', request)('https://mcp.mcd.cn', { method: 'POST' });
    const init = request.mock.calls[0][1]!;
    expect(new Headers(init.headers).get('Authorization')).toBe('synthetic-token');
    expect(init.redirect).toBe('manual');
  });
  it('rejects arbitrary endpoints before sending the token', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(officialFetch('synthetic-token', request)('https://example.com/')).rejects.toMatchObject({ code: 'ENDPOINT_BLOCKED' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([[302, 'REDIRECT_BLOCKED'], [401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [429, 'RATE_LIMITED'], [503, 'UPSTREAM_UNAVAILABLE']])('maps HTTP %i to safe error %s', async (status, code) => {
    const request = vi.fn<typeof fetch>(async () => new Response('private upstream body', { status: Number(status) }));
    await expect(officialFetch('synthetic-token', request)('https://mcp.mcd.cn/')).rejects.toMatchObject({ code });
  });
  it('supports draft 2020-12 schema and rejects unsupported dialects', () => {
    expect(validateSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }, {})).toBe(true);
    expect(() => validateSchema({ $schema: 'https://example.com/unknown-schema' }, {})).toThrow('不受支持');
  });
});
