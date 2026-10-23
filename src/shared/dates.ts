import type { ItemDate, RadarItem } from './model.js';

const DAY = 86_400_000;
const OFFSET = 8 * 3_600_000;

export function beijingDay(time: string | number | Date): string {
  return new Date(new Date(time).getTime() + OFFSET).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export function parseDate(value: unknown): ItemDate | null {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      ? { precision: 'day', value }
      : null;
  }
  // A timestamp must include a timezone. Never guess seconds vs milliseconds or local time.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !parseDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  if (match[5] !== 'Z') {
    const [hour, minute] = match[5].slice(1).split(':').map(Number);
    if (hour > 14 || minute > 59 || (hour === 14 && minute !== 0)) return null;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? { precision: 'instant', value: new Date(time).toISOString() } : null;
}

export function dateDay(date: ItemDate): string {
  return date.precision === 'day' ? date.value : beijingDay(date.value);
}

export function dateTime(date: ItemDate): number {
  return Date.parse(date.precision === 'day' ? `${date.value}T00:00:00+08:00` : date.value);
}

export type Urgency = 'past' | 'today' | 'soon' | 'later' | 'unknown';

export function urgency(item: RadarItem, now: string): Urgency {
  if (!item.date) return 'unknown';
  const current = Date.parse(now);
  const date = item.date;
  const end = dateTime(date) + (date.precision === 'day' ? DAY : 0);
  if (current >= end) return 'past';
  const today = beijingDay(now);
  const day = dateDay(date);
  if (today === day) return 'today';
  return day <= addDays(today, 7) ? 'soon' : 'later';
}

export function sortItems(items: RadarItem[]): RadarItem[] {
  return [...items].sort((a, b) => {
    if (!a.date) return b.date ? 1 : a.id.localeCompare(b.id);
    if (!b.date) return -1;
    return dateTime(a.date) - dateTime(b.date) || a.id.localeCompare(b.id);
  });
}

export function formatItemDate(item: RadarItem): string {
  if (!item.date) return '未提供明确日期';
  const day = dateDay(item.date);
  const date = `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
  const action = item.category === 'campaign' ? '活动日期' : '到期';
  if (item.date.precision === 'day') return `${date} ${action} · 仅日期`;
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(item.date.value));
  return `${date} ${time} ${action}`;
}
