import type { Shift } from '@/types';

export interface ShiftConflict {
  type: 'OVERLAP' | 'OVERTIME' | 'OVER_HOURS' | 'SHORT_REST' | 'BREAK_MISSING';
  message: string;
}

// Federal OT threshold. Crossing this doesn't break the schedule but the
// manager should see "you're paying 1.5x from here on" before publishing.
const OVERTIME_HOURS = 40;
// Anything beyond this is almost certainly a mistake.
const HARD_HOURS_LIMIT = 50;
// NJ/PA don't mandate a minimum rest period between shifts for adults, but
// 8h is the internal policy Pelican wants to enforce (and what most retail
// chains use to avoid "clopening" burnout).
const MIN_REST_HOURS = 8;
// Any shift longer than this implies the employee should be getting a meal
// break. NJ/PA don't mandate breaks for adult retail workers, but policy is
// to schedule one for anything ≥6h. This is a soft warning.
const BREAK_REQUIRED_HOURS = 6;

/**
 * Detects conflicts between shifts assigned to the same user.
 * - OVERLAP: two shifts for the same user overlap in time
 * - OVERTIME: user will hit 40h+ this week (1.5x pay warning)
 * - OVER_HOURS: user scheduled > 50 hours in the week (probably a mistake)
 * - SHORT_REST: <8h gap between consecutive shifts ("clopening")
 * - BREAK_MISSING: shift 6+ hours for a minor without a meal break
 *
 * @param minorUserIds — set of user IDs flagged as minors. Only these
 *   employees trigger the BREAK_MISSING conflict.
 */
export function detectConflicts(
  shifts: Shift[],
  minorUserIds: Set<string> = new Set(),
): Map<string, ShiftConflict[]> {
  const conflicts = new Map<string, ShiftConflict[]>();
  const add = (id: string, c: ShiftConflict) => {
    const list = conflicts.get(id) || [];
    list.push(c);
    conflicts.set(id, list);
  };

  // Break compliance: only applies to employees flagged as minors.
  // Minors require a 30-min meal break for any shift 6+ hours.
  for (const s of shifts) {
    if (!s.user || !minorUserIds.has(s.user.id)) continue;
    const hours =
      (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
    if (hours >= BREAK_REQUIRED_HOURS) {
      add(s.id, {
        type: 'BREAK_MISSING',
        message: `${hours.toFixed(1)}h shift for a minor — 30-min meal break required`,
      });
    }
  }

  // Group by user
  const byUser = new Map<string, Shift[]>();
  for (const s of shifts) {
    if (!s.user) continue;
    const list = byUser.get(s.user.id) || [];
    list.push(s);
    byUser.set(s.user.id, list);
  }

  for (const [, userShifts] of byUser) {
    const sorted = userShifts
      .slice()
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Overlap detection
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const aStart = new Date(sorted[i].startTime).getTime();
        const aEnd = new Date(sorted[i].endTime).getTime();
        const bStart = new Date(sorted[j].startTime).getTime();
        const bEnd = new Date(sorted[j].endTime).getTime();

        if (aStart < bEnd && bStart < aEnd) {
          add(sorted[i].id, { type: 'OVERLAP', message: 'Overlaps with another shift' });
          add(sorted[j].id, { type: 'OVERLAP', message: 'Overlaps with another shift' });
        }
      }
    }

    // Min-rest check: flag pairs of consecutive (non-overlapping) shifts
    // whose gap is below MIN_REST_HOURS. Only the later shift gets the flag
    // — that's the one the manager would move to fix the clopening.
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = new Date(sorted[i - 1].endTime).getTime();
      const curStart = new Date(sorted[i].startTime).getTime();
      const gapHours = (curStart - prevEnd) / 3600000;
      if (gapHours > 0 && gapHours < MIN_REST_HOURS) {
        add(sorted[i].id, {
          type: 'SHORT_REST',
          message: `Only ${gapHours.toFixed(1)}h rest after previous shift (min ${MIN_REST_HOURS}h)`,
        });
      }
    }

    // Weekly totals: OVERTIME is a soft warning, OVER_HOURS is a hard one.
    const totalHours = sorted.reduce(
      (sum, s) => sum + (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000,
      0
    );
    if (totalHours > HARD_HOURS_LIMIT) {
      for (const s of sorted) {
        add(s.id, {
          type: 'OVER_HOURS',
          message: `Over ${HARD_HOURS_LIMIT}h this week (${totalHours.toFixed(1)}h)`,
        });
      }
    } else if (totalHours > OVERTIME_HOURS) {
      for (const s of sorted) {
        add(s.id, {
          type: 'OVERTIME',
          message: `Overtime: ${totalHours.toFixed(1)}h this week (>40h = 1.5x pay)`,
        });
      }
    }
  }

  return conflicts;
}
