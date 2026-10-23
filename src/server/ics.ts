import { createHash } from 'node:crypto';
import { addDays } from '../shared/dates.js';
import { CATEGORY_LABELS, type RadarItem, type Snapshot } from '../shared/model.js';
import { AppError } from './errors.js';

export function escapeIcs(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

export function foldLine(value: string): string {
  const lines: string[] = [];
  let line = '';
  let bytes = 0;
  for (const char of value) {
    const length = Buffer.byteLength(char, 'utf8');
    if (bytes + length > 75) {
      lines.push(line);
      line = ' ';
      bytes = 1;
    }
    line += char;
    bytes += length;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function stamp(value: string): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function event(item: RadarItem, snapshot: Snapshot): string[] {
  if (!item.date) throw new AppError('DATE_REQUIRED', '所选项目没有明确日期，不能导出。', 400);
  const demo = snapshot.mode === 'demo' ? '【演示数据】' : '';
  const action = item.category === 'campaign' ? '活动日期' : '到期提醒';
  const uid = createHash('sha256').update(`${snapshot.mode}:${item.id}`).digest('hex');
  const lines = [
    'BEGIN:VEVENT', `UID:${uid}@mcd-expiry-radar.local`,
    `DTSTAMP:${stamp(snapshot.fetchedAt)}`,
    `SUMMARY:${escapeIcs(`${demo}${CATEGORY_LABELS[item.category]} · ${item.title}`)}`,
    `DESCRIPTION:${escapeIcs(`${demo}${action}。${item.note}\n仅查询，不下单、不兑换。按需决定；请以官方渠道为准。日期以北京时间解释。`)}`,
    'STATUS:TENTATIVE', 'TRANSP:TRANSPARENT',
  ];
  if (item.date.precision === 'day') {
    lines.push(`DTSTART;VALUE=DATE:${item.date.value.replaceAll('-', '')}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(item.date.value, 1).replaceAll('-', '')}`);
  } else {
    lines.push(`DTSTART:${stamp(item.date.value)}`);
    // This is a point-in-time reminder, not an invented offer duration.
  }
  lines.push(
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`${demo}${action}：${item.title}`)}`,
    'END:VALARM', 'END:VEVENT',
  );
  return lines;
}

export function createCalendar(snapshot: Snapshot, selectedIds: string[]): string {
  if (selectedIds.length === 0 || selectedIds.length > 100 || new Set(selectedIds).size !== selectedIds.length) {
    throw new AppError('SELECTION_INVALID', '请选择 1–100 个不同的项目。', 400);
  }
  const selected = selectedIds.map((id) => {
    const item = snapshot.items.find((entry) => entry.id === id);
    if (!item) throw new AppError('ITEM_NOT_FOUND', '所选项目不属于当前查询，请刷新后重新选择。', 400);
    return item;
  });
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Guoan-Tang//Mcd Expiry Radar 1.0//ZH',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${snapshot.mode === 'demo' ? '【演示数据】' : ''}麦麦到期雷达`,
    'X-WR-TIMEZONE:Asia/Shanghai',
    ...selected.flatMap((item) => event(item, snapshot)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
