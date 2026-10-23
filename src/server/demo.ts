import { randomUUID } from 'node:crypto';
import { addDays, beijingDay, sortItems } from '../shared/dates.js';
import { TOOL_NAMES, type Snapshot } from '../shared/model.js';
import { parseTool } from './parse.js';

// Entirely synthetic fixtures, not captured responses or a claim about the official schema.
export function demoSnapshot(now = new Date().toISOString()): Snapshot {
  const today = beijingDay(now);
  const fixtures: Record<string, unknown> = {
    'now-time-info': { currentTime: now },
    'query-my-coupons': { coupons: [
      { id: 'demo-c1', title: '早餐搭配优惠券', expiryDate: today },
      { id: 'demo-c2', title: '咖啡时光优惠券', expiryDate: addDays(today, 2) },
      { id: 'demo-c3', title: '双人分享优惠券', expiryDate: addDays(today, 6) },
      { id: 'demo-c4', title: '周末小食优惠券', expiryDate: addDays(today, 12) },
      { id: 'demo-c5', title: '待核实有效期的优惠券' },
      { id: 'demo-c6', title: '已过期示例券', expiryDate: addDays(today, -1) },
    ] },
    'query-my-account': { expiringPoints: 680 },
    'campaign-calendar': { campaigns: [
      { id: 'demo-a1', title: '周末相聚日 · 合成活动', startDate: addDays(today, 1) },
      { id: 'demo-a2', title: '下周新鲜事 · 合成活动', startDate: addDays(today, 5) },
    ] },
  };
  const parsed = TOOL_NAMES.map((tool) => parseTool(tool, { structuredContent: fixtures[tool] }));
  return {
    id: randomUUID(), mode: 'demo', fetchedAt: now, now, clock: 'local',
    items: sortItems(parsed.flatMap((value) => value.items)),
    sources: parsed.map((value) => ({ ...value.report, message: `合成演示：${value.report.message}` })),
  };
}
