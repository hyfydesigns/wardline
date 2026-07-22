/**
 * Pure policy computation — no DB, no I/O, so it's unit-testable and shared by
 * the /api/policy route. Decides whether the internet should be off right now
 * given the household schedule and the child's screen-time limit.
 */

export interface Schedule {
  name: string;
  kind: string;
  days: number[]; // 0=Mon .. 6=Sun
  startMin: number;
  endMin: number;
  scope: string;
}

export interface ActiveBlock {
  blocked: boolean;
  reason: string | null;
}

/** JS getDay() is 0=Sun..6=Sat; our schedules use 0=Mon..6=Sun. */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function computeActiveBlock(
  schedules: Schedule[],
  limitMin: number,
  usedMin: number,
  now: Date,
): { activeBlock: ActiveBlock; minuteOfDay: number; dayOfWeek: number } {
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  const dayOfWeek = mondayIndex(now);

  const active = schedules.find(
    (s) => s.scope === 'all internet' && s.days.includes(dayOfWeek) && minuteOfDay >= s.startMin && minuteOfDay < s.endMin,
  );

  let blocked = false;
  let reason: string | null = null;
  if (active) {
    blocked = true;
    reason = active.name;
  } else if (usedMin >= limitMin) {
    blocked = true;
    reason = 'Daily screen-time limit reached';
  }

  return { activeBlock: { blocked, reason }, minuteOfDay, dayOfWeek };
}
