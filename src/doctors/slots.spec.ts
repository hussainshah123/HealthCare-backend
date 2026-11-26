import { findSlot, hasOverlap, slotsForDate } from './slots.js';

// 2026-11-24 is a Tuesday (dayOfWeek 2).
const tuesday = { dayOfWeek: 2, startTime: '09:00', endTime: '10:00', slotMinutes: 20 };

describe('doctor slots', () => {
  it('splits a window into slots in local time (UTC+5)', () => {
    const slots = slotsForDate('2026-11-24', [tuesday], 300);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      '2026-11-24T04:00:00.000Z',
      '2026-11-24T04:20:00.000Z',
      '2026-11-24T04:40:00.000Z',
    ]);
    expect(slots[2].endsAt.toISOString()).toBe('2026-11-24T05:00:00.000Z');
  });

  it('offers nothing on other days', () => {
    expect(slotsForDate('2026-11-25', [tuesday], 300)).toEqual([]);
  });

  it('drops a trailing partial slot', () => {
    const slots = slotsForDate('2026-11-24', [{ ...tuesday, endTime: '09:50' }], 300);
    expect(slots).toHaveLength(2);
  });

  it('finds only exact slot starts', () => {
    expect(findSlot(new Date('2026-11-24T04:20:00.000Z'), [tuesday], 300)).not.toBeNull();
    expect(findSlot(new Date('2026-11-24T04:25:00.000Z'), [tuesday], 300)).toBeNull();
  });

  it('detects overlapping windows on the same day', () => {
    expect(hasOverlap([tuesday, { ...tuesday, startTime: '09:30', endTime: '11:00' }])).toBe(true);
    expect(hasOverlap([tuesday, { ...tuesday, startTime: '10:00', endTime: '11:00' }])).toBe(false);
    expect(hasOverlap([tuesday, { ...tuesday, dayOfWeek: 3 }])).toBe(false);
  });
});
