import { describe, expect, it } from 'vitest';
import { addDays, beijingDay, formatItemDate, parseDate, sortItems, urgency } from '../src/shared/dates.js';
import type { RadarItem } from '../src/shared/model.js';

const item = (value: string | null, category: RadarItem['category'] = 'coupon'): RadarItem => ({
  id: String(value), title: '合成条目', category, date: parseDate(value),
  note: '', source: 'query-my-coupons',
});

describe('strict dates and Beijing boundaries', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-10-23 12:00:00', '2026-10-23T12:00:00',
    '2026-10-23T24:00:00+08:00', '2026-10-23T12:60:00Z', '2026-10-23T12:00:00+14:30',
    '明天', '10/23/26'])('rejects ambiguous/invalid date %s', (value) => {
    expect(parseDate(value)).toBeNull();
  });
  it('rejects numeric epochs rather than guessing units', () => {
    expect(parseDate(1792713600)).toBeNull();
  });
  it('normalizes a timestamp without losing the actual instant', () => {
    expect(parseDate('2026-10-23T00:00:00+08:00')).toEqual({ precision: 'instant', value: '2026-10-22T16:00:00.000Z' });
  });
  it('uses Beijing, regardless of host timezone', () => {
    expect(beijingDay('2026-10-22T16:00:00Z')).toBe('2026-10-23');
    expect(beijingDay('2026-10-22T15:59:59Z')).toBe('2026-10-22');
  });
  it('handles leap days and year boundaries', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(parseDate('2027-02-29')).toBeNull();
  });
  it('keeps a day-only expiry current until the next Beijing day', () => {
    expect(urgency(item('2026-10-23'), '2026-10-23T15:59:59Z')).toBe('today');
    expect(urgency(item('2026-10-23'), '2026-10-23T16:00:00Z')).toBe('past');
  });
  it('marks precise expiry at the exact boundary', () => {
    const coupon = item('2026-10-23T12:00:00+08:00');
    expect(urgency(coupon, '2026-10-23T03:59:59Z')).toBe('today');
    expect(urgency(coupon, '2026-10-23T04:00:00Z')).toBe('past');
  });
  it('uses inclusive seven calendar days and separates unknown dates', () => {
    expect(urgency(item('2026-10-30'), '2026-10-23T12:00:00Z')).toBe('soon');
    expect(urgency(item('2026-10-31'), '2026-10-23T12:00:00Z')).toBe('later');
    expect(urgency(item(null), '2026-10-23T12:00:00Z')).toBe('unknown');
  });
  it('labels activity dates separately from deadlines', () => {
    expect(formatItemDate(item('2026-10-23', 'campaign'))).toBe('10月23日 活动日期 · 仅日期');
    expect(formatItemDate(item('2026-10-23T12:30:00+08:00'))).toContain('12:30 到期');
  });
  it('sorts unknown dates last without mutating input', () => {
    const original = [item(null), item('2026-10-25'), item('2026-10-23')];
    expect(sortItems(original).map((value) => value.date?.value ?? null)).toEqual(['2026-10-23', '2026-10-25', null]);
    expect(original[0].date).toBeNull();
  });
});
