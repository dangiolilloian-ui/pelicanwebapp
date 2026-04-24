const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { loadScope, coversShift } = require('../lib/managerScope');

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
// on a shift. Delegates to managerScope.coversShift so this rule stays in
// sync with the roster/dashboard scope — there's exactly one answer to
// "which shifts is this manager responsible for".
//   OWNER            — always allowed.
//   'all' scope      — allowed (unconfigured admin/manager: back-compat).
//   'store' scope    — shift.locationId must be in managedLocations.
//   'dept' scope     — shift.locationId + positionId must both belong to one
//                      of the user's managedDepartments.
//   anything else    — 403.
// Returns null if allowed, or an { status, error } object to return.
async function checkAttendanceAuthority(user, shift) {
  if (user.role === 'OWNER') return null;
  if (!['ADMIN', 'MANAGER'].includes(user.role)) {
    return { status: 403, error: 'Forbidden' };
  }
  const scope = await loadScope(user.id, user.role);
  if (coversShift(scope, shift)) return null;
  return { status: 403, error: 'Not authorized for this shift' };
}

// Log an attendance event on a shift (manager+). Authority comes from
// checkAttendanceAuthority above, which delegates to managerScope so the
// rule is identical to the live-roster's "what can I see" question.
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
