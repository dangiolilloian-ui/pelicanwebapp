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

// Log an attendance event on a shift (manager+)
router.post('/shift/:shiftId', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { type, notes } = req.body;
  if (!['CALLOUT', 'LATE', 'NO_SHOW'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type. Must be CALLOUT, LATE, or NO_SHOW' });
  }

  const shift = await prisma.shift.findUnique({
    where: { id: req.params.shiftId },
    select: { organizationId: true, userId: true },
  });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (!shift.userId) {
    return res.status(400).json({ error: 'Cannot log attendance on an unassigned shift' });
  }

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

// Delete an attendance event (manager+)
router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const event = await prisma.attendanceEvent.findUnique({
    where: { id: req.params.id },
    include: { shift: { select: { organizationId: true } } },
  });
  if (!event || event.shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
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
