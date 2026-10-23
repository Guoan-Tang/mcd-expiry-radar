import { describe, expect, it } from 'vitest';
import { createCalendar, escapeIcs, foldLine } from '../src/server/ics.js';
import { demoSnapshot } from '../src/server/demo.js';

const snapshot = demoSnapshot('2026-10-23T04:00:00Z');
const dated = snapshot.items.filter((item) => item.date);
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('RFC 5545 calendar', () => {
  it('uses CRLF and exclusive next-day end for all-day dates', () => {
    const today = dated.find((item) => item.date?.value === '2026-10-23')!;
    const calendar = createCalendar(snapshot, [today.id]);
    expect(calendar).toContain('DTSTART;VALUE=DATE:20261023\r\nDTEND;VALUE=DATE:20261024');
    expect(calendar.replaceAll('\r\n', '')).not.toContain('\n');
    expect(calendar.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('uses UTC for exact instants rather than floating local times', () => {
    const custom = structuredClone(snapshot);
    custom.items[0].date = { precision: 'instant', value: '2026-10-23T00:30:00+08:00' };
    const calendar = createCalendar(custom, [custom.items[0].id]);
    expect(calendar).toContain('DTSTART:20261022T163000Z');
    expect(calendar).not.toContain('DTEND');
  });
  it('handles year-end correctly', () => {
    const custom = structuredClone(snapshot);
    custom.items[0].date = { precision: 'day', value: '2026-12-31' };
    expect(createCalendar(custom, [custom.items[0].id])).toContain('DTEND;VALUE=DATE:20270101');
  });
  it('folds at 75 UTF-8 octets including continuation whitespace', () => {
    const text = `SUMMARY:${'你好🙂,世界;'.repeat(40)}`;
    const folded = foldLine(text);
    expect(folded.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(unfold(folded)).toBe(text);
    expect(folded).not.toContain('\ufffd');
  });
  it('escapes delimiters and prevents injected events', () => {
    expect(escapeIcs('a\\b,c;d\r\nEND:VEVENT')).toBe('a\\\\b\\,c\\;d\\nEND:VEVENT');
    const custom = structuredClone(snapshot);
    custom.items[0].title = '合成\nEND:VEVENT\nBEGIN:VEVENT';
    const calendar = createCalendar(custom, [custom.items[0].id]);
    expect(calendar.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
  });
  it('uses deterministic UIDs across refreshes but isolates demo/live', () => {
    const extract = (text: string) => unfold(text).match(/UID:(.+)\r\n/)![1];
    const selected = [dated[0].id];
    const first = extract(createCalendar(snapshot, selected));
    const refresh = { ...snapshot, id: 'new-snapshot', fetchedAt: '2026-10-23T05:00:00Z' };
    expect(extract(createCalendar(refresh, selected))).toBe(first);
    expect(extract(createCalendar({ ...snapshot, mode: 'live' }, selected))).not.toBe(first);
  });
  it('labels demo events and alarms', () => {
    const calendar = unfold(createCalendar(snapshot, [dated[0].id]));
    expect(calendar).toContain('SUMMARY:【演示数据】');
    expect(calendar).toContain('DESCRIPTION:【演示数据】');
    expect(calendar).toContain('TRIGGER:-P1D');
  });
  it('rejects undated, unknown and duplicate selections', () => {
    expect(() => createCalendar(snapshot, [snapshot.items.find((item) => !item.date)!.id])).toThrow('明确日期');
    expect(() => createCalendar(snapshot, ['unknown'])).toThrow('不属于');
    expect(() => createCalendar(snapshot, [dated[0].id, dated[0].id])).toThrow('不同');
    expect(() => createCalendar(snapshot, [])).toThrow('请选择');
  });
  it('does not leak snapshot or raw account identifiers', () => {
    const calendar = createCalendar(snapshot, [dated[0].id]);
    expect(calendar).not.toContain(snapshot.id);
    expect(calendar).not.toContain('demo-c');
  });
});
