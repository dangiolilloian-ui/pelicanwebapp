const prisma = require('../config/db');

// Defaults used when an org hasn't customized its policy. Values chosen to
// mirror typical retail point systems (e.g. Walmart, Target, Kroger):
// no-shows are severe (3 pts), a late is lighter (1 pt), early outs in the
// middle (1 pt). 90-day rolling window. Warn at 6, final at 10.
const DEFAULTS = {
  windowDays: 90,
  lateMinutes: 5,        // grace period before "late" kicks in
  earlyOutMinutes: 10,   // grace for leaving early
  pointsNoShow: 3,
  pointsLate: 1,
  pointsEarlyOut: 1,
  thresholdWarn: 6,
  thresholdFinal: 10,
};

async function getConfig(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { attendanceConfig: true },
  });
  return { ...DEFAULTS, ...(org?.attendanceConfig || {}) };
}

// Returns { config, windowStart, byEmployee: [{ id, name, points, status, incidents }] }
// where status is 'clear' | 'warn' | 'final' based on the configured thresholds.
async function computePoints(organizationId) {
  const config = await getConfig(organizationId);
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowDays * 24 * 3600 * 1000);

  // Pull all relevant published + assigned shifts in the window whose end
  // time has passed — anything still in the future can't be a no-show yet.
  const shifts = await prisma.shift.findMany({
    where: {
      organizationId,
      status: 'PUBLISHED',
      userId: { not: null },
      startTime: { gte: windowStart },
      endTime: { lte: now },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  const shiftIds = shifts.map((s) => s.id);
  const entries = shiftIds.length
    ? await prisma.timeEntry.findMany({ where: { shiftId: { in: shiftIds } } })
    : [];
  const entryByShift = new Map(entries.map((e) => [e.shiftId, e]));

  const byEmp = new Map();
  const bump = (user, kind, pts, detail) => {
    const row = byEmp.get(user.id) || {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      points: 0,
      noShow: 0,
      late: 0,
      earlyOut: 0,
      incidents: [],
    };
    row.points += pts;
    row[kind] += 1;
    row.incidents.push({ kind, pts, ...detail });
    byEmp.set(user.id, row);
  };

  for (const s of shifts) {
    const entry = entryByShift.get(s.id);
    if (!entry) {
      bump(s.user, 'noShow', config.pointsNoShow, {
        shiftId: s.id,
        startTime: s.startTime,
      });
      continue;
    }
    const lateMs = new Date(entry.clockIn).getTime() - new Date(s.startTime).getTime();
    if (lateMs > config.lateMinutes * 60 * 1000) {
      bump(s.user, 'late', config.pointsLate, {
        shiftId: s.id,
        startTime: s.startTime,
        clockIn: entry.clockIn,
        lateMinutes: Math.round(lateMs / 60000),
      });
    }
    if (entry.clockOut) {
      const earlyMs = new Date(s.endTime).getTime() - new Date(entry.clockOut).getTime();
      if (earlyMs > config.earlyOutMinutes * 60 * 1000) {
        bump(s.user, 'earlyOut', config.pointsEarlyOut, {
          shiftId: s.id,
          endTime: s.endTime,
          clockOut: entry.clockOut,
          earlyMinutes: Math.round(earlyMs / 60000),
        });
      }
    }
  }

  const classify = (points) => {
    if (points >= config.thresholdFinal) return 'final';
    if (points >= config.thresholdWarn) return 'warn';
    return 'clear';
  };

  // Also include manually logged attendance events from managers.
  const manualEvents = await prisma.attendanceEvent.findMany({
    where: {
      shift: { organizationId },
      createdAt: { gte: windowStart },
    },
    include: {
      shift: {
        select: { id: true, startTime: true },
        include: { user: { select: { id: true, firstName: true, lastName: true } } },
      },
    },
  });

  for (const evt of manualEvents) {
    if (!evt.shift.user) continue;
    const kindMap = { CALLOUT: 'noShow', LATE: 'late', NO_SHOW: 'noShow' };
    const ptsMap = { CALLOUT: config.pointsNoShow, LATE: config.pointsLate, NO_SHOW: config.pointsNoShow };
    const kind = kindMap[evt.type] || 'noShow';
    const pts = ptsMap[evt.type] || 0;
    bump(evt.shift.user, kind, pts, {
      shiftId: evt.shift.id,
      startTime: evt.shift.startTime,
      manual: true,
      eventType: evt.type,
      notes: evt.notes,
    });
  }

  const byEmployee = [...byEmp.values()]
    .map((r) => ({ ...r, status: classify(r.points) }))
    .sort((a, b) => b.points - a.points);

  return { config, windowStart, byEmployee };
}

module.exports = { DEFAULTS, getConfig, computePoints };
