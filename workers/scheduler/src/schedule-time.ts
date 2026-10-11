import { createHash } from 'node:crypto';

export interface DailySchedule {
  readonly hour: number;
  readonly jitterMinutes: number;
  readonly minute: number;
  readonly siteId: string;
  readonly timezone: string;
}

export function nextDailyOccurrence(schedule: DailySchedule, after: Date): Date {
  if (schedule.hour < 0 || schedule.hour > 23 || schedule.minute < 0 || schedule.minute > 59) {
    throw new Error('Invalid local schedule time');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    timeZone: schedule.timezone,
    year: 'numeric',
  });
  const jitter = deterministicJitter(schedule.siteId, schedule.jitterMinutes);
  const start = Math.ceil(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < 3 * 24 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (
      Number(parts.hour) * 60 + Number(parts.minute) ===
      schedule.hour * 60 + schedule.minute + jitter
    ) {
      return candidate;
    }
  }
  throw new Error('No valid occurrence found within three days');
}

export function scheduleWindowKey(schedule: DailySchedule, occurrence: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: schedule.timezone,
    year: 'numeric',
  }).format(occurrence);
  return `${schedule.siteId}:${day}`;
}

function deterministicJitter(siteId: string, maximum: number): number {
  if (!Number.isInteger(maximum) || maximum < 0 || maximum > 120) throw new Error('Invalid jitter');
  if (maximum === 0) return 0;
  return createHash('sha256').update(siteId).digest().readUInt32BE(0) % (maximum + 1);
}
