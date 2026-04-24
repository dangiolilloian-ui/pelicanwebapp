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

// Live roster — "who's on the floor right now".
//
// Returns every PUBLISHED shift currently in progress, grouped by
// location → position. Each person is tagged with an attendance state +
// a `canManage` flag that tells the frontend whether to show action
// buttons and reveal the full manager-only state detail.
//
// Role-based scope and detail:
//
//   OWNER    — sees all locations org-wide, full detail, canManage=true.
//   ADMIN    — sees everything at their managedLocations, full detail,
//              canManage=true on everyone there.
//   MANAGER  — sees everything at their managedLocations with full
//              detail on every row. canManage=true only for shifts in
//              positions they manage (their own department); rows in
//              other departments are read-only but still show full
//              attendance state.
//   EMPLOYEE — sees only checked-in coworkers at their work `locations`.
//              Anyone who isn't checked in (or who has a CALLOUT /
//              NO_SHOW) is hidden entirely to keep the view simple and
//              protect privacy.
//
// Attendance states:
//
//   Manager view  → NOT_CHECKED_IN | CHECKED_IN | LATE | CALLOUT | NO_SHOW
//   Employee view → CHECKED_IN only (no one else is listed)
//
// State precedence (manager view): CALLOUT/NO_SHOW > LATE > CHECKED_IN > NOT_CHECKED_IN.
//
// For canManage=true rows we also return `events` so the frontend knows
// which events are active — toggle UI then POSTs to create or DELETEs
// to remove.
router.get('/live-roster', authenticate, async (req, res) => {
  const orgId = req.user.organizationId;
  const now = new Date();
  const role = req.user.role;

  // Figure out scope + authority sets for this viewer.
  let managedLocationIds = new Set();
  let managedPositionIds = new Set();
  let locationIdFilter; // undefined → no filter (OWNER)

  if (role !== 'OWNER') {
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        managedLocations: { select: { id: true } },
        managedPositions: { select: { id: true } },
        locations: { select: { id: true } },
      },
    });
    managedLocationIds = new Set((me?.managedLocations || []).map((l) => l.id));
    managedPositionIds = new Set((me?.managedPositions || []).map((p) => p.id));
    const workLocationIds = (me?.locations || []).map((l) => l.id);

    // ADMIN/MANAGER scope by their managed locations; EMPLOYEE scopes
    // by the locations they're assigned to work at.
    const locIds = role === 'EMPLOYEE' ? workLocationIds : [...managedLocationIds];
    if (locIds.length === 0) {
      return res.json({
        generatedAt: now.toISOString(),
        viewerRole: role,
        locations: [],
      });
    }
    locationIdFilter = { in: locIds };
  }

  // All PUBLISHED shifts in progress right now, within the viewer's scope.
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

  // Pull attendance events for those shifts in one query.
  const shiftIds = liveShifts.map((s) => s.id);
  const events = shiftIds.length
    ? await prisma.attendanceEvent.findMany({
        where: { shiftId: { in: shiftIds } },
        select: { id: true, shiftId: true, type: true },
      })
    : [];
  // shiftId → Map<type, eventId>. Multiple events of the same type per
  // shift shouldn't happen (we always toggle), but if they do, last write
  // wins — fine for display.
  const eventsByShift = new Map();
  for (const ev of events) {
    if (!eventsByShift.has(ev.shiftId)) eventsByShift.set(ev.shiftId, new Map());
    eventsByShift.get(ev.shiftId).set(ev.type, ev.id);
  }

  // Group by location → position.
  const locMap = new Map();
  for (const s of liveShifts) {
    if (!s.user) continue;

    // canManage: can this viewer log attendance actions on this person?
    let canManage = false;
    if (role === 'OWNER') canManage = true;
    else if (role === 'ADMIN') canManage = managedLocationIds.has(s.location?.id);
    else if (role === 'MANAGER') {
      canManage =
        managedLocationIds.has(s.location?.id) && managedPositionIds.has(s.position?.id);
    }

    const evMap = eventsByShift.get(s.id) || new Map();
    const hasCallout = evMap.has('CALLOUT');
    const hasNoShow = evMap.has('NO_SHOW');
    const hasLate = evMap.has('LATE');
    const hasCheckedIn = evMap.has('CHECKED_IN');

    // Employees only see coworkers who are actively checked in — no one
    // else is visible. This keeps the view uncluttered and avoids
    // revealing private attendance details (late / called out / not
    // checked in yet).
    if (role === 'EMPLOYEE') {
      if (!hasCheckedIn || hasCallout || hasNoShow) continue;
    }

    let state;
    if (role === 'EMPLOYEE') {
      state = 'CHECKED_IN';
    } else {
      // Manager tiers (OWNER / ADMIN / MANAGER) always see full detail.
      if (hasCallout) state = 'CALLOUT';
      else if (hasNoShow) state = 'NO_SHOW';
      else if (hasLate) state = 'LATE';
      else if (hasCheckedIn) state = 'CHECKED_IN';
      else state = 'NOT_CHECKED_IN';
    }

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
    loc.positions.get(posKey).people.push({
      userId: s.user.id,
      name: `${s.user.firstName} ${s.user.lastName}`,
      shiftId: s.id,
      scheduledStart: s.startTime,
      scheduledEnd: s.endTime,
      state,
      canManage,
      // Only include event ids for managers who can act on this row —
      // the frontend uses these to decide POST vs DELETE when toggling.
      events: canManage
        ? {
            checkedIn: hasCheckedIn ? evMap.get('CHECKED_IN') : null,
            late: hasLate ? evMap.get('LATE') : null,
            callout: hasCallout ? evMap.get('CALLOUT') : null,
            noShow: hasNoShow ? evMap.get('NO_SHOW') : null,
          }
        : null,
    });
  }

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
    // Drop locations/positions that ended up empty after privacy filtering.
    .map((loc) => ({
      ...loc,
      positions: loc.positions.filter((p) => p.people.length > 0),
    }))
    .filter((loc) => loc.positions.length > 0)
    .sort((a, b) => a.locationName.localeCompare(b.locationName));

  res.json({
    generatedAt: now.toISOString(),
    viewerRole: role,
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
