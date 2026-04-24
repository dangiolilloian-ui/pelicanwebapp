const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// Get attendance events for a shift
router.get('/shift/:shiftId', authenticate, async (req, res) => {
  const shift = await prisma.shift.findUnique({
    where: { id: req.params.shiftId },
    select: { organizationId: true },
  });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }

  const events = await prisma.attendanceEvent.findMany({
    where: { shiftId: req.params.shiftId },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(events);
});

// Verify that a manager-tier viewer has authority to log/unlog events
// on a shift. OWNER can act on anything. ADMIN must have the shift's
// location in managedLocations. MANAGER additionally must have the
// shift's position in managedPositions (their own department).
// Returns null if allowed, or an { status, error } object to return.
async function checkAttendanceAuthority(user, shift) {
  if (user.role === 'OWNER') return null;
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return { status: 403, error: 'Forbidden' };
  }
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      managedLocations: { select: { id: true } },
      managedPositions: { select: { id: true } },
    },
  });
  const locIds = new Set((me?.managedLocations || []).map((l) => l.id));
  const posIds = new Set((me?.managedPositions || []).map((p) => p.id));

  if (shift.locationId && !locIds.has(shift.locationId)) {
    return { status: 403, error: 'Not authorized for this location' };
  }
  if (user.role === 'MANAGER') {
    if (!shift.positionId || !posIds.has(shift.positionId)) {
      return { status: 403, error: 'Not authorized for this department' };
    }
  }
  return null;
}

// Log an attendance event on a shift (manager+).
// Managers can only log events on shifts in their department
// (managedLocations ∩ managedPositions). Admins need the shift's
// location to be in their managedLocations. Owners can act on anything.
router.post('/shift/:shiftId', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { type, notes } = req.body;
  if (!['CALLOUT', 'LATE', 'NO_SHOW', 'CHECKED_IN'].includes(type)) {
    return res
      .status(400)
      .json({ error: 'Invalid type. Must be CALLOUT, LATE, NO_SHOW, or CHECKED_IN' });
  }

  const shift = await prisma.shift.findUnique({
    where: { id: req.params.shiftId },
    select: { organizationId: true, userId: true, locationId: true, positionId: true },
  });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (!shift.userId) {
    return res.status(400).json({ error: 'Cannot log attendance on an unassigned shift' });
  }

  const authErr = await checkAttendanceAuthority(req.user, shift);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  const event = await prisma.attendanceEvent.create({
    data: {
      shiftId: req.params.shiftId,
      userId: shift.userId,
      type,
      notes: notes || null,
      createdById: req.user.id,
    },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  res.status(201).json(event);
});

// Delete an attendance event (manager+, scoped same as POST).
router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const event = await prisma.attendanceEvent.findUnique({
    where: { id: req.params.id },
    include: {
      shift: {
        select: { organizationId: true, locationId: true, positionId: true },
      },
    },
  });
  if (!event || event.shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const authErr = await checkAttendanceAuthority(req.user, event.shift);
  if (authErr) return res.status(authErr.status).json({ error: authErr.error });

  await prisma.attendanceEvent.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Get all attendance events for a user (for the attendance dashboard)
router.get('/user/:userId', authenticate, async (req, res) => {
  // Managers see any user in their org; employees see only themselves
  const isManager = ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user.role);
  if (!isManager && req.params.userId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const target = await prisma.user.findUnique({
    where: { id: req.params.userId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Rolling 90-day window by default
  const windowDays = 90;
  const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);

  const events = await prisma.attendanceEvent.findMany({
    where: {
      userId: req.params.userId,
      createdAt: { gte: since },
    },
    include: {
      shift: { select: { id: true, startTime: true, endTime: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(events);
});

module.exports = router;
