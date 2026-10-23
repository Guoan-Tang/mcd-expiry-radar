import { describe, expect, it } from 'vitest';
import { parseTool, unwrapResult } from '../src/server/parse.js';

const result = (value: unknown) => ({ structuredContent: value });

describe('synthetic adapter shapes, not recorded official responses', () => {
  it('handles structured content, wrappers and JSON text', () => {
    const data = { coupons: [{ title: '合成券', expiryDate: '2026-10-23' }] };
    const structured = parseTool('query-my-coupons', result({ data }));
    const text = parseTool('query-my-coupons', { content: [{ type: 'text', text: JSON.stringify({ result: data }) }] });
    expect(text.items).toEqual(structured.items);
    expect(text.items).toHaveLength(1);
  });
  it('never interprets natural language dates as facts', () => {
    expect(() => unwrapResult({ content: [{ type: 'text', text: '即将到期 680 积分，可能是月底' }] })).toThrow('文本');
  });
  it('treats tool and business errors as failures', () => {
    expect(() => unwrapResult({ isError: true, ...result({ coupons: [] }) })).toThrow('业务错误');
    expect(() => unwrapResult(result({ code: 401, data: { coupons: [] } }))).toThrow('业务错误');
    expect(() => unwrapResult(result({ success: false, data: [] }))).toThrow('业务错误');
  });
  it('distinguishes empty lists from unsupported envelopes', () => {
    expect(parseTool('query-my-coupons', result({ coupons: [] })).report.state).toBe('empty');
    expect(parseTool('query-my-coupons', result({ unknown: [] })).report.state).toBe('unsupported');
  });
  it('never converts account balance into expiring points', () => {
    expect(parseTool('query-my-account', result({ balance: 680 })).report.state).toBe('unsupported');
  });
  it('preserves undated point risk and rejects guessed dates', () => {
    const parsed = parseTool('query-my-account', result({ expiringPoints: 680, pointsExpiryDate: '月底' }));
    expect(parsed.items[0]).toMatchObject({ amount: 680, date: null, category: 'points' });
    expect(parsed.report.state).toBe('partial');
  });
  it('recognizes a point-specific expiry field only', () => {
    const account = { expiringPoints: 680, expiryDate: '2026-10-23' };
    expect(parseTool('query-my-account', result(account)).items[0].date).toBeNull();
    expect(parseTool('query-my-account', result({ ...account, pointsExpiryDate: '2026-10-24' })).items[0].date?.value).toBe('2026-10-24');
  });
  it.each([-1, '680', 1.5, Infinity])('does not coerce invalid point count %s', (expiringPoints) => {
    expect(parseTool('query-my-account', result({ expiringPoints })).report.state).toBe('unsupported');
  });
  it('reports zero points explicitly', () => {
    expect(parseTool('query-my-account', result({ expiringPoints: 0 }))).toMatchObject({ items: [], report: { state: 'empty' } });
  });
  it('does not treat campaign end as its start or expiry risk', () => {
    const parsed = parseTool('campaign-calendar', result({ activities: [{ name: '合成活动', endDate: '2026-10-24' }] }));
    expect(parsed.items[0]).toMatchObject({ category: 'campaign', date: null });
  });
  it('reports malformed rows and pagination without losing good rows', () => {
    const parsed = parseTool('query-my-coupons', result({
      coupons: [null, { something: true }, { title: '合成券', expiryDate: '2026-10-23' }],
      total: 10, hasMore: true,
    }));
    expect(parsed.items).toHaveLength(1);
    expect(parsed.report.state).toBe('partial');
    expect(parsed.report.message).toContain('不是完整列表');
    expect(parsed.report.message).toContain('2 项无法识别');
  });
  it('hashes identity, deduplicates and never exposes raw coupon IDs or token echoes', () => {
    const row = { id: 'private-account-coupon-id', title: '合成 SENSITIVE_FAKE_TOKEN 券' };
    const parsed = parseTool('query-my-coupons', result({ coupons: [row, row] }), 'SENSITIVE_FAKE_TOKEN');
    expect(parsed.items).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain('private-account');
    expect(JSON.stringify(parsed)).not.toContain('SENSITIVE_FAKE_TOKEN');
    expect(parsed.items[0].title).toContain('[已隐藏]');
  });
  it('rejects excessive result sizes', () => {
    expect(() => parseTool('query-my-coupons', result({ coupons: Array(501).fill({ title: '合成' }) }))).toThrow('500');
  });
  it('does not use a date-only official clock as a precise time', () => {
    expect(parseTool('now-time-info', result({ now: '2026-10-23' })).now).toBeUndefined();
  });
});
