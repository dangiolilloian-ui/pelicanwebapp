const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.get('/stats', authenticate, async (req, res) => {
  const orgId = req.user.organizationId;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const [totalEmployees, weekShifts, pendingTimeOff, locations] = await Promise.all([
    prisma.user.count({ where: { organizationId: orgId } }),
    prisma.shift.findMany({
      where: { organizationId: orgId, startTime: { gte: weekStart, lt: weekEnd } },
      include: { user: { select: { id: true, firstName: true, lastName: true } }, position: true, location: true },
    }),
    prisma.timeOffRequest.count({
      where: {
        status: 'PENDING',
        user: { organizationId: orgId },
      },
    }),
    prisma.location.findMany({ where: { organizationId: orgId } }),
  ]);

  const totalHours = weekShifts.reduce(
    (sum, s) => sum + (new Date(s.endTime) - new Date(s.startTime)) / 3600000, 0
  );

  const drafts = weekShifts.filter((s) => s.status === 'DRAFT').length;
  const published = weekShifts.filter((s) => s.status === 'PUBLISHED').length;
  const unassigned = weekShifts.filter((s) => !s.userId).length;

  // Hours per employee
  const hoursPerEmployee = {};
  for (const s of weekShifts) {
    if (!s.user) continue;
    const key = s.user.id;
    if (!hoursPerEmployee[key]) {
      hoursPerEmployee[key] = { id: s.user.id, name: `${s.user.firstName} ${s.user.lastName}`, hours: 0, shifts: 0 };
    }
    hoursPerEmployee[key].hours += (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
    hoursPerEmployee[key].shifts++;
  }

  const topWorkers = Object.values(hoursPerEmployee)
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  // Shifts per location
  const shiftsPerLocation = {};
  for (const s of weekShifts) {
    const loc = s.location?.name || 'Unassigned';
    if (!shiftsPerLocation[loc]) shiftsPerLocation[loc] = { location: loc, shifts: 0, hours: 0 };
    shiftsPerLocation[loc].shifts++;
    shiftsPerLocation[loc].hours += (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
  }

  // Shifts per position
  const shiftsPerPosition = {};
  for (const s of weekShifts) {
    const pos = s.position?.name || 'Unassigned';
    if (!shiftsPerPosition[pos]) shiftsPerPosition[pos] = { position: pos, shifts: 0, color: s.position?.color || '#94a3b8' };
    shiftsPerPosition[pos].shifts++;
  }

  res.json({
    totalEmployees,
    totalShifts: weekShifts.length,
    totalHours: Math.round(totalHours * 10) / 10,
    drafts,
    published,
    unassigned,
    pendingTimeOff,
    topWorkers,
    byLocation: Object.values(shiftsPerLocation),
    byPosition: Object.values(shiftsPerPosition).sort((a, b) => b.shifts - a.shifts),
  });
});

// Personal stats for the current user (employee view)
router.get('/me', authenticate, async (req, res) => {
  const userId = req.user.id;
  const orgId = req.user.organizationId;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 14);

  const [weekShifts, upcomingShifts, openSwaps, pendingTimeOff, activeEntry] = await Promise.all([
    prisma.shift.findMany({
      where: {
        userId,
        startTime: { gte: weekStart, lt: weekEnd },
        status: 'PUBLISHED',
      },
    }),
    prisma.shift.findMany({
      where: {
        userId,
        startTime: { gte: now, lt: horizon },
        status: 'PUBLISHED',
      },
      include: {
        position: { select: { name: true, color: true } },
        location: { select: { name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 10,
    }),
    prisma.shiftSwap.findMany({
      where: {
        status: 'PENDING',
        shift: { organizationId: orgId },
        requesterId: { not: userId },
        OR: [{ targetUserId: userId }, { targetUserId: null }],
      },
      include: {
        shift: {
          include: {
            position: { select: { name: true, color: true } },
            location: { select: { name: true } },
          },
        },
        requester: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.timeOffRequest.count({ where: { userId, status: 'PENDING' } }),
    prisma.timeEntry.findFirst({ where: { userId, clockOut: null } }),
  ]);

  const weekHours = weekShifts.reduce(
    (sum, s) => sum + (new Date(s.endTime) - new Date(s.startTime)) / 3600000, 0
  );

  res.json({
    weekShifts: weekShifts.length,
    weekHours: Math.round(weekHours * 10) / 10,
    upcomingShifts,
    openSwaps,
    pendingTimeOff,
    clockedIn: !!activeEntry,
    activeClockInAt: activeEntry?.clockIn || null,
  });
});

// Live roster — "who's on the floor right now" for the manager overview.
//
// Returns every PUBLISHED shift currently in progress, grouped by
// location → position, each person tagged with an attendance state the
// frontend renders as a colored dot:
//
//   PRESENT  (green)   — default; no manager event logged
//   LATE     (yellow)  — manager logged a LATE event for this shift
//   CALLOUT  (red)     — manager logged a CALLOUT event for this shift
//   NO_SHOW  (red)     — manager logged a NO_SHOW event for this shift
//
// We deliberately do NOT infer lateness from time clock data — the time
// clock feature is being phased out and "late" only means "a manager
// explicitly marked this person late."
//
// Scoping: Owners see the whole org. Other roles (ADMIN, MANAGER) see
// only the locations they're explicitly assigned to via
// User.managedLocations. If a manager has no managed locations, they see
// nothing here — we don't fall back to org-wide for this widget because
// the intent is "who's on MY floor".
router.get('/live-roster', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const orgId = req.user.organizationId;
  const now = new Date();

  // Figure out which locations this user can see.
  let locationIdFilter; // undefined → no filter (owners)
  if (req.user.role !== 'OWNER') {
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { managedLocations: { select: { id: true } } },
    });
    const locIds = me?.managedLocations.map((l) => l.id) || [];
    if (locIds.length === 0) {
      // No assigned locations → nothing to show.
      return res.json({ generatedAt: now.toISOString(), locations: [] });
    }
    locationIdFilter = { in: locIds };
  }

  // All PUBLISHED shifts in progress right now, with user/position/location.
  const liveShifts = await prisma.shift.findMany({
    where: {
      organizationId: orgId,
      status: 'PUBLISHED',
      userId: { not: null },
      startTime: { lte: now },
      endTime: { gt: now },
      ...(locationIdFilter ? { locationId: locationIdFilter } : {}),
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      user: { select: { id: true, firstName: true, lastName: true } },
      location: { select: { id: true, name: true } },
      position: { select: { id: true, name: true, color: true } },
    },
  });

  // Pull any manager-logged attendance events for those shifts in one query.
  const shiftIds = liveShifts.map((s) => s.id);
  const events = shiftIds.length
    ? await prisma.attendanceEvent.findMany({
        where: { shiftId: { in: shiftIds } },
        select: { shiftId: true, type: true },
      })
    : [];
  // If multiple events exist for a shift, prefer the most severe one:
  // CALLOUT / NO_SHOW > LATE.
  const severity = { CALLOUT: 3, NO_SHOW: 3, LATE: 2 };
  const eventByShift = new Map();
  for (const ev of events) {
    const cur = eventByShift.get(ev.shiftId);
    if (!cur || (severity[ev.type] || 0) > (severity[cur] || 0)) {
      eventByShift.set(ev.shiftId, ev.type);
    }
  }

  // Group by location → position.
  const locMap = new Map(); // locationId|'_none' → { location, positions: Map }
  for (const s of liveShifts) {
    if (!s.user) continue;
    const locKey = s.location?.id || '_none';
    if (!locMap.has(locKey)) {
      locMap.set(locKey, {
        locationId: s.location?.id || null,
        locationName: s.location?.name || 'Unassigned',
        positions: new Map(),
      });
    }
    const loc = locMap.get(locKey);
    const posKey = s.position?.id || '_none';
    if (!loc.positions.has(posKey)) {
      loc.positions.set(posKey, {
        positionId: s.position?.id || null,
        positionName: s.position?.name || 'Unassigned',
        positionColor: s.position?.color || null,
        people: [],
      });
    }
    const evType = eventByShift.get(s.id) || null;
    let state = 'PRESENT';
    if (evType === 'LATE') state = 'LATE';
    else if (evType === 'CALLOUT') state = 'CALLOUT';
    else if (evType === 'NO_SHOW') state = 'NO_SHOW';
    loc.positions.get(posKey).people.push({
      userId: s.user.id,
      name: `${s.user.firstName} ${s.user.lastName}`,
      shiftId: s.id,
      scheduledStart: s.startTime,
      scheduledEnd: s.endTime,
      state,
    });
  }

  // Serialize maps → arrays, sorted alphabetically.
  const locations = [...locMap.values()]
    .map((loc) => ({
      locationId: loc.locationId,
      locationName: loc.locationName,
      positions: [...loc.positions.values()]
        .map((p) => ({
          ...p,
          people: p.people.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.positionName.localeCompare(b.positionName)),
    }))
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  res.json({
    generatedAt: now.toISOString(),
    locations,
  });
});

// Today's snapshot — quick glance for a manager opening the dashboard at
// 10am to see "how's today shaping up". Everything is computed in local
// server time, which is fine for a single-region org; if we ever ship
// multi-TZ orgs we'll revisit via Organization.timezone.
router.get('/today', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const orgId = req.user.organizationId;
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);

  const [shifts, openEntries, salesRows] = await Promise.all([
    prisma.shift.findMany({
      where: {
        organizationId: orgId,
        startTime: { gte: dayStart, lt: dayEnd },
      },
      include: { position: { select: { hourlyRate: true } } },
    }),
    prisma.timeEntry.findMany({
      where: {
        clockOut: null,
        user: { organizationId: orgId },
      },
      select: { id: true, breakStartedAt: true },
    }),
    prisma.dailySales.findMany({
      where: {
        organizationId: orgId,
        date: { gte: dayStart, lt: dayEnd },
      },
    }),
  ]);

  let plannedHours = 0;
  let plannedCost = 0;
  for (const s of shifts) {
    const h = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
    plannedHours += h;
    plannedCost += h * (s.position?.hourlyRate || 0);
  }

  const clockedIn = openEntries.length;
  const onBreak = openEntries.filter((e) => e.breakStartedAt).length;

  const salesTotal = salesRows.reduce((sum, r) => sum + r.amount, 0);

  res.json({
    date: dayStart.toISOString().slice(0, 10),
    shiftsScheduled: shifts.length,
    plannedHours: Math.round(plannedHours * 10) / 10,
    plannedLaborCost: Math.round(plannedCost),
    clockedInNow: clockedIn,
    onBreakNow: onBreak,
    salesToday: salesTotal,
    salesEntered: salesRows.length > 0,
  });
});

module.exports = router;
