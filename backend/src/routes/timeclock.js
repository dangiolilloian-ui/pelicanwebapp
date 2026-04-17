const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { distanceMeters } = require('../lib/distance');

const router = Router();

// Shared clock-in logic so /clock-in and the kiosk route can reuse it.
// Throws { status, error } on validation failure.
async function performClockIn({ userId, latitude, longitude, overrideGeofence = false }) {
  const existing = await prisma.timeEntry.findFirst({
    where: { userId, clockOut: null },
  });
  if (existing) {
    const err = new Error('Already clocked in');
    err.status = 400;
    throw err;
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 2 * 3600000);
  const windowEnd = new Date(now.getTime() + 2 * 3600000);
  const shift = await prisma.shift.findFirst({
    where: {
      userId,
      status: 'PUBLISHED',
      startTime: { gte: windowStart, lte: windowEnd },
    },
    include: { location: true },
    orderBy: { startTime: 'asc' },
  });

  // Geofence: if the shift has a location with coordinates, enforce radius
  if (!overrideGeofence && shift?.location?.latitude != null && shift?.location?.longitude != null) {
    if (latitude == null || longitude == null) {
      const err = new Error(
        `Location permission is required to clock in at ${shift.location.name}.`
      );
      err.status = 403;
      err.code = 'GEOFENCE_REQUIRED';
      throw err;
    }
    const d = distanceMeters(
      latitude,
      longitude,
      shift.location.latitude,
      shift.location.longitude
    );
    if (d > shift.location.radiusMeters) {
      const err = new Error(
        `You're ${Math.round(d)}m from ${shift.location.name}. Move within ${shift.location.radiusMeters}m to clock in.`
      );
      err.status = 403;
      err.code = 'GEOFENCE_OUT_OF_RANGE';
      err.distance = Math.round(d);
      throw err;
    }
  }

  return prisma.timeEntry.create({
    data: {
      userId,
      shiftId: shift?.id || null,
      clockIn: now,
    },
  });
}

// Current active entry for the logged-in user (if clocked in)
router.get('/active', authenticate, async (req, res) => {
  const active = await prisma.timeEntry.findFirst({
    where: { userId: req.user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });
  res.json(active || null);
});

// List entries — own for employees, all for managers
router.get('/', authenticate, async (req, res) => {
  const { start, end, userId } = req.query;
  const where = {};

  if (req.user.role === 'EMPLOYEE') {
    where.userId = req.user.id;
  } else {
    // Manager: can filter by userId or see all org entries
    const orgUsers = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true },
    });
    where.userId = userId || { in: orgUsers.map((u) => u.id) };
  }

  if (start && end) {
    where.clockIn = { gte: new Date(start), lte: new Date(end) };
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { clockIn: 'desc' },
    take: 200,
  });
  res.json(entries);
});

// Clock in
router.post('/clock-in', authenticate, async (req, res) => {
  const { latitude, longitude } = req.body || {};
  try {
    const entry = await performClockIn({
      userId: req.user.id,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
    });
    res.status(201).json(entry);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || 'Clock-in failed',
      code: err.code,
      distance: err.distance,
    });
  }
});

// Clock out (auto-closes any active break)
router.post('/clock-out', authenticate, async (req, res) => {
  const active = await prisma.timeEntry.findFirst({
    where: { userId: req.user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });
  if (!active) {
    return res.status(400).json({ error: 'Not clocked in' });
  }

  const now = new Date();
  let extraBreakMinutes = 0;
  if (active.breakStartedAt) {
    extraBreakMinutes = Math.floor((now.getTime() - new Date(active.breakStartedAt).getTime()) / 60000);
  }

  const entry = await prisma.timeEntry.update({
    where: { id: active.id },
    data: {
      clockOut: now,
      breakStartedAt: null,
      totalBreakMinutes: active.totalBreakMinutes + extraBreakMinutes,
      notes: req.body?.notes || active.notes,
    },
  });

  // Optional handoff note lives on the shift, not the time entry, so the
  // next opener at the same location can pick it up via /shifts/:id/previous-handoff.
  if (req.body?.handoffNote && active.shiftId) {
    await prisma.shift.update({
      where: { id: active.shiftId },
      data: { handoffNote: String(req.body.handoffNote).slice(0, 2000) },
    });
  }

  res.json(entry);
});

// Start a break on the active entry
router.post('/break/start', authenticate, async (req, res) => {
  const active = await prisma.timeEntry.findFirst({
    where: { userId: req.user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });
  if (!active) return res.status(400).json({ error: 'Not clocked in' });
  if (active.breakStartedAt) return res.status(400).json({ error: 'Break already in progress' });

  const entry = await prisma.timeEntry.update({
    where: { id: active.id },
    data: { breakStartedAt: new Date() },
  });
  res.json(entry);
});

// End the current break, adding elapsed minutes to the running total
router.post('/break/end', authenticate, async (req, res) => {
  const active = await prisma.timeEntry.findFirst({
    where: { userId: req.user.id, clockOut: null },
    orderBy: { clockIn: 'desc' },
  });
  if (!active) return res.status(400).json({ error: 'Not clocked in' });
  if (!active.breakStartedAt) return res.status(400).json({ error: 'No break in progress' });

  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - new Date(active.breakStartedAt).getTime()) / 60000)
  );

  const entry = await prisma.timeEntry.update({
    where: { id: active.id },
    data: {
      breakStartedAt: null,
      totalBreakMinutes: active.totalBreakMinutes + elapsed,
    },
  });
  res.json(entry);
});

// Manager edit (correct mistakes)
router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { clockIn, clockOut, notes } = req.body;
  const entry = await prisma.timeEntry.update({
    where: { id: req.params.id },
    data: {
      ...(clockIn && { clockIn: new Date(clockIn) }),
      ...(clockOut !== undefined && { clockOut: clockOut ? new Date(clockOut) : null }),
      ...(notes !== undefined && { notes }),
    },
  });
  res.json(entry);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  await prisma.timeEntry.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
module.exports.performClockIn = performClockIn;
