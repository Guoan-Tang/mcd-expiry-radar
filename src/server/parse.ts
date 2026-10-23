import { createHash } from 'node:crypto';
import { parseDate } from '../shared/dates.js';
import type { Category, RadarItem, SourceReport, ToolName } from '../shared/model.js';
import { AppError } from './errors.js';

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function first(object: Record<string, unknown>, keys: string[]): unknown {
  return keys.map((key) => object[key]).find((value) => value !== undefined && value !== null);
}

function text(value: unknown, secret?: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const redacted = secret ? value.split(secret).join('[已隐藏]') : value;
  return redacted.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
}

function points(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1e12
    ? value : null;
}

export function stableId(category: Category, title: string, date: RadarItem['date'], identity?: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([category, typeof identity === 'string' ? identity : null, title, date]))
    .digest('hex').slice(0, 24);
}

export function unwrapResult(result: unknown): unknown {
  if (!record(result)) throw new AppError('RESULT_INVALID', 'MCP 返回不是合法工具结果。');
  if (result.isError === true) throw new AppError('TOOL_ERROR', 'MCP 工具返回业务错误；未将其当成空账户。');
  let value: unknown = result.structuredContent;
  if (value === undefined && Array.isArray(result.content)) {
    const blocks = result.content.filter((block) => record(block) && block.type === 'text');
    if (blocks.length === 1 && record(blocks[0]) && typeof blocks[0].text === 'string') {
      try {
        value = JSON.parse(blocks[0].text);
      } catch {
        throw new AppError('UNSUPPORTED_FORMAT', '返回的是文本而非可验证结构；未猜测其中的日期或积分。');
      }
    }
  }
  if (value === undefined) throw new AppError('UNSUPPORTED_FORMAT', '没有可识别的结构化结果；需要核实返回格式。');
  if (JSON.stringify(value).length > 1_000_000) throw new AppError('RESULT_TOO_LARGE', '结果超过本地处理上限。');
  for (let depth = 0; depth < 3 && record(value); depth++) {
    if (value.success === false || value.error ||
        (typeof value.code === 'number' && ![0, 200].includes(value.code)) ||
        (typeof value.code === 'string' && !['0', '200', 'SUCCESS', 'OK'].includes(value.code))) {
      throw new AppError('BUSINESS_ERROR', '服务返回业务错误；未将其当成查询成功。');
    }
    if (record(value.data) || Array.isArray(value.data)) value = value.data;
    else if (record(value.result) || Array.isArray(value.result)) value = value.result;
    else break;
  }
  return value;
}

export interface Parsed {
  items: RadarItem[];
  report: SourceReport;
  now?: string;
}

export function parseTool(tool: ToolName, result: unknown, secret?: string): Parsed {
  const value = unwrapResult(result);
  const report: SourceReport = { tool, state: 'ok', message: '已解析返回字段；请以官方渠道为准。' };
  if (tool === 'now-time-info') {
    const date = parseDate(record(value) ? first(value, ['currentTime', 'now', 'datetime']) : value);
    if (!date || date.precision !== 'instant') {
      return { items: [], report: { tool, state: 'unsupported', message: '官方时间格式无法识别；明确使用本机北京时间。' } };
    }
    return { items: [], now: date.value, report };
  }
  if (tool === 'query-my-account') {
    const account = record(value) && record(value.account) ? value.account : value;
    const amount = record(account) ? points(first(account, ['expiringPoints', 'pointsExpiring', 'expirePoints'])) : null;
    if (amount === null || !record(account)) {
      return { items: [], report: { tool, state: 'unsupported', message: '未识别即将过期积分字段；不能用总积分推算。' } };
    }
    if (amount === 0) return { items: [], report: { tool, state: 'empty', message: '返回的即将过期积分为 0。' } };
    const date = parseDate(first(account, ['pointsExpireAt', 'pointsExpiryDate']));
    const title = `${amount.toLocaleString('zh-CN')} 积分待关注`;
    return {
      items: [{
        id: stableId('points', title, date), category: 'points', title, date, amount, source: tool,
        note: date ? '这是积分到期风险，不是优惠券。仅在确有需要时自行查看官方兑换规则。'
          : '服务未提供可识别的精确到期日。请到官方账户核实；此项不能导出日历。',
      }],
      report: date ? report : { tool, state: 'partial', message: '已识别到期风险积分，但没有明确到期日。' },
    };
  }
  const category = tool === 'query-my-coupons' ? 'coupon' : 'campaign';
  const listKeys = category === 'coupon' ? ['coupons', 'couponList'] : ['campaigns', 'activities'];
  const list = Array.isArray(value) ? value : record(value) ? first(value, listKeys) : undefined;
  if (!Array.isArray(list)) {
    return { items: [], report: { tool, state: 'unsupported', message: '未识别列表结构；不代表账户没有数据。' } };
  }
  if (list.length > 500) throw new AppError('RESULT_TOO_LARGE', '列表超过 500 项，未展示不完整的成功结果。');
  let ignored = 0;
  let missingDate = 0;
  const items: RadarItem[] = [];
  for (const row of list) {
    if (!record(row)) { ignored++; continue; }
    const title = text(first(row, ['title', 'name', category === 'coupon' ? 'couponName' : 'campaignName']), secret);
    if (!title) { ignored++; continue; }
    const date = parseDate(first(row, category === 'coupon'
      ? ['expiresAt', 'expiryDate', 'expireTime', 'endDate']
      : ['startAt', 'startDate', 'date']));
    if (!date) missingDate++;
    const item: RadarItem = {
      id: stableId(category, title, date, first(row, ['id', 'couponId', 'campaignId'])),
      category, title, date, source: tool,
      note: category === 'coupon' ? '使用门槛、适用门店与餐品以官方券面为准；不计算未经核实的节省金额。'
        : '仅作活动日期提示，不表示你已获得优惠或具备参加资格。',
    };
    if (!items.some((existing) => existing.id === item.id)) items.push(item);
  }
  const paginationUnknown = record(value) && (
    value.hasMore === true || Boolean(value.nextCursor) ||
    (typeof value.total === 'number' && value.total > list.length)
  );
  if (ignored || missingDate || paginationUnknown) {
    report.state = 'partial';
    report.message = `已整理 ${items.length} 项；${missingDate} 项无明确日期，${ignored} 项无法识别。${paginationUnknown ? '服务提示还有分页，当前不是完整列表。' : ''}`;
  } else if (list.length === 0) {
    report.state = 'empty';
    report.message = '该工具明确返回空列表。';
  }
  return { items, report };
}
