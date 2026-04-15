const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

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
// Combines three things in one payload so the frontend can render the whole
// widget off a single 30-second poll:
//
//   working  — has an open TimeEntry (clocked in, not on break)
//   onBreak  — has an open TimeEntry with breakStartedAt set
//   absent   — has a PUBLISHED shift whose start time is ≥5 min in the
//              past and <shiftEnd, but no open TimeEntry linked to them
//              (i.e. scheduled and not here)
//
// "Absent" is noisy in the first few minutes of a shift (staff walking in,
// swiping in a moment late), so we apply the same 5-min grace we use for
// attendance lateness elsewhere in the app.
const { requireRole } = require('../middleware/auth');
router.get('/live-roster', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const orgId = req.user.organizationId;
  const now = new Date();
  const GRACE_MS = 5 * 60 * 1000;
  const graceCutoff = new Date(now.getTime() - GRACE_MS);

  // Open time entries (still clocked in) in this org.
  const openEntries = await prisma.timeEntry.findMany({
    where: {
      clockOut: null,
      user: { organizationId: orgId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // We need the scheduled end time + location for each open entry, when
  // linked to a shift. Batch fetch so we don't N+1 per user.
  const linkedShiftIds = [...new Set(openEntries.map((e) => e.shiftId).filter(Boolean))];
  const linkedShifts = linkedShiftIds.length
    ? await prisma.shift.findMany({
        where: { id: { in: linkedShiftIds } },
        select: { id: true, endTime: true, location: { select: { name: true } }, position: { select: { name: true, color: true } } },
      })
    : [];
  const shiftById = new Map(linkedShifts.map((s) => [s.id, s]));

  const working = [];
  const onBreak = [];
  const onClockUserIds = new Set();

  for (const e of openEntries) {
    onClockUserIds.add(e.userId);
    const shift = e.shiftId ? shiftById.get(e.shiftId) : null;
    const row = {
      userId: e.userId,
      name: `${e.user.firstName} ${e.user.lastName}`,
      clockIn: e.clockIn,
      scheduledEnd: shift?.endTime || null,
      locationName: shift?.location?.name || null,
      positionName: shift?.position?.name || null,
      positionColor: shift?.position?.color || null,
      breakStartedAt: e.breakStartedAt || null,
    };
    if (e.breakStartedAt) onBreak.push(row);
    else working.push(row);
  }

  // Absent: published shifts that should be in progress but aren't.
  const liveShifts = await prisma.shift.findMany({
    where: {
      organizationId: orgId,
      status: 'PUBLISHED',
      userId: { not: null },
      startTime: { lte: graceCutoff },
      endTime: { gt: now },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      location: { select: { name: true } },
      position: { select: { name: true, color: true } },
    },
  });

  const absent = liveShifts
    .filter((s) => s.user && !onClockUserIds.has(s.user.id))
    .map((s) => ({
      userId: s.user.id,
      name: `${s.user.firstName} ${s.user.lastName}`,
      scheduledStart: s.startTime,
      scheduledEnd: s.endTime,
      locationName: s.location?.name || null,
      positionName: s.position?.name || null,
      positionColor: s.position?.color || null,
      minutesLate: Math.floor((now.getTime() - new Date(s.startTime).getTime()) / 60000),
    }));

  res.json({
    generatedAt: now.toISOString(),
    working: working.sort((a, b) => a.name.localeCompare(b.name)),
    onBreak: onBreak.sort((a, b) => a.name.localeCompare(b.name)),
    absent: absent.sort((a, b) => b.minutesLate - a.minutesLate),
  });
});

// Today's snapshot — quick glance for a manager opening the dashboard at
// 10am to see "how's today shaping up". Everything is computed in local
// server time, which is fine for a single-region org; if we ever ship
// multi-TZ orgs we'll revisit via Organization.timezone.
router.get('/today', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
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
