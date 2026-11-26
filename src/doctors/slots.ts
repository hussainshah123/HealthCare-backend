export interface AvailabilityWindow {
  dayOfWeek: number;
  startTime: string; // "HH:mm" local
  endTime: string;
  slotMinutes: number;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

/** Minutes east of UTC for the platform's local time (Pakistan: +300, no DST). */
export function platformOffsetMinutes(): number {
  const raw = Number(process.env.TZ_OFFSET_MINUTES ?? 300);
  return Number.isFinite(raw) ? raw : 300;
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * All slots a doctor offers on a local calendar date (YYYY-MM-DD), as UTC instants.
 */
export function slotsForDate(date: string, windows: AvailabilityWindow[], offsetMinutes: number): Slot[] {
  const [y, mo, d] = date.split('-').map(Number);
  const localMidnightUtc = Date.UTC(y, mo - 1, d) - offsetMinutes * 60_000;
  const dayOfWeek = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();

  const slots: Slot[] = [];
  for (const w of windows.filter((w) => w.dayOfWeek === dayOfWeek)) {
    const end = toMinutes(w.endTime);
    for (let start = toMinutes(w.startTime); start + w.slotMinutes <= end; start += w.slotMinutes) {
      const startsAt = new Date(localMidnightUtc + start * 60_000);
      slots.push({ startsAt, endsAt: new Date(startsAt.getTime() + w.slotMinutes * 60_000) });
    }
  }
  return slots.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The slot that starts exactly at `startsAt`, if the doctor offers one then. */
export function findSlot(startsAt: Date, windows: AvailabilityWindow[], offsetMinutes: number): Slot | null {
  const local = new Date(startsAt.getTime() + offsetMinutes * 60_000);
  const date = local.toISOString().slice(0, 10);
  return slotsForDate(date, windows, offsetMinutes).find((s) => s.startsAt.getTime() === startsAt.getTime()) ?? null;
}

/** Windows on the same day must not overlap. */
export function hasOverlap(windows: AvailabilityWindow[]): boolean {
  for (let day = 0; day < 7; day++) {
    const sorted = windows
      .filter((w) => w.dayOfWeek === day)
      .map((w) => [toMinutes(w.startTime), toMinutes(w.endTime)] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < sorted.length; i++) if (sorted[i][0] < sorted[i - 1][1]) return true;
  }
  return false;
}

export function slotKey(doctorId: string, startsAt: Date): string {
  return `${doctorId}|${startsAt.toISOString()}`;
}
