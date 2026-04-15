const prisma = require('../config/db');

// Returns the minimum simultaneous coverage within [windowStart, windowEnd]
// across the given shifts. Uses a sweep: sort start(+1)/end(-1) events, walk,
// and track the lowest running count across each gap. Any interval of the
// window not covered contributes count=0.
function minCoverage(windowStart, windowEnd, shifts) {
  const events = [];
  for (const s of shifts) {
    const start = Math.max(new Date(s.startTime).getTime(), windowStart);
    const end = Math.min(new Date(s.endTime).getTime(), windowEnd);
    if (end <= start) continue;
    events.push([start, 1]);
    events.push([end, -1]);
  }
  if (events.length === 0) return 0;

  // Sort by time; process end events before start events at the same instant
  // so a shift ending exactly when another starts is a handoff, not overlap.
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  let t = windowStart;
  let count = 0;
  let min = Infinity;
  for (const [et, delta] of events) {
    if (et > t) {
      if (count < min) min = count;
      t = et;
    }
    count += delta;
  }
  if (t < windowEnd && count < min) min = count;
  return min === Infinity ? 0 : min;
}

// Build the datetime window for a requirement on a specific calendar date.
// "HH:mm" strings are applied in the server's local timezone, matching how
// recurringShifts expands its rules.
function windowFor(date, startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = new Date(date);
  start.setHours(sh, sm, 0, 0);
  const end = new Date(date);
  end.setHours(eh, em, 0, 0);
  if (end <= start) end.setDate(end.getDate() + 1); // overnight
  return { start, end };
}

// Walk each calendar day in [rangeStart, rangeEnd), look up the requirements
// that match that weekday, and return every slot that falls short.
//
// `includeDrafts` defaults to true so the schedule preview answers "with my
// current plan, do I cover?". Set to false to check only what's live.
async function computeCoverageGaps({ organizationId, rangeStart, rangeEnd, includeDrafts = true }) {
  const requirements = await prisma.coverageRequirement.findMany({
    where: { organizationId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
  if (requirements.length === 0) return [];

  const statusFilter = includeDrafts ? ['DRAFT', 'PUBLISHED'] : ['PUBLISHED'];
  const shifts = await prisma.shift.findMany({
    where: {
      organizationId,
      status: { in: statusFilter },
      userId: { not: null },
      startTime: { lt: new Date(rangeEnd) },
      endTime: { gt: new Date(rangeStart) },
    },
    select: { id: true, startTime: true, endTime: true, locationId: true, userId: true },
  });

  // Index shifts by location for quick filtering per requirement.
  const byLocation = new Map();
  for (const s of shifts) {
    const key = s.locationId || '_null_';
    if (!byLocation.has(key)) byLocation.set(key, []);
    byLocation.get(key).push(s);
  }

  const gaps = [];
  const start = new Date(rangeStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay();
    for (const req of requirements) {
      if (req.dayOfWeek !== weekday) continue;
      const { start: wStart, end: wEnd } = windowFor(d, req.startTime, req.endTime);

      // Eligible shifts: either matching the requirement's location, or
      // (when the requirement is org-wide) any shift anywhere.
      let pool;
      if (req.locationId) {
        pool = byLocation.get(req.locationId) || [];
      } else {
        pool = shifts;
      }

      const actual = minCoverage(wStart.getTime(), wEnd.getTime(), pool);
      if (actual < req.minStaff) {
        gaps.push({
          requirementId: req.id,
          locationId: req.locationId,
          date: new Date(d).toISOString().slice(0, 10),
          dayOfWeek: req.dayOfWeek,
          startTime: req.startTime,
          endTime: req.endTime,
          minStaff: req.minStaff,
          actual,
          shortfall: req.minStaff - actual,
          notes: req.notes || null,
        });
      }
    }
  }

  return gaps;
}

module.exports = { computeCoverageGaps, minCoverage };
