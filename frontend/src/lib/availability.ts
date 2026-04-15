import type { AvailabilityEntry, TimeOffEntry } from '@/hooks/useAvailability';

export type CellStatus = 'available' | 'unavailable' | 'time-off' | 'unknown';

/**
 * Classify an (employee, day) cell for the planner overlay.
 *
 * Rules — aligned with backend/src/lib/availabilityCheck.js:
 *   1. If the day is inside an APPROVED time-off range → 'time-off'
 *   2. If the user has any availability entry for that dayOfWeek with
 *      available=false → 'unavailable' (whole day blocked)
 *   3. If the user has any available=true entries for that dayOfWeek → 'available'
 *   4. Otherwise → 'unknown' (no declared preference)
 */
export function getCellStatus(
  userId: string,
  day: Date,
  availabilities: AvailabilityEntry[],
  timeOff: TimeOffEntry[]
): CellStatus {
  if (userId === '__unassigned__') return 'unknown';

  // Compare day at local midnight to the approved time-off ranges.
  const dayMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  for (const t of timeOff) {
    if (t.userId !== userId || t.status !== 'APPROVED') continue;
    const start = new Date(t.startDate);
    const end = new Date(t.endDate);
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    if (dayMs >= startMs && dayMs <= endMs) return 'time-off';
  }

  const dow = day.getDay();
  const entries = availabilities.filter((a) => a.userId === userId && a.dayOfWeek === dow);
  if (entries.length === 0) return 'unknown';
  if (entries.some((e) => !e.available)) return 'unavailable';
  return 'available';
}
