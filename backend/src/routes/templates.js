const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const templates = await prisma.shiftTemplate.findMany({
    where: { organizationId: req.user.organizationId },
    include: {
      position: { select: { id: true, name: true, color: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(templates);
});

router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { name, startTime, endTime, positionId, locationId, notes } = req.body;
  const template = await prisma.shiftTemplate.create({
    data: {
      name,
      startTime,
      endTime,
      positionId: positionId || null,
      locationId: locationId || null,
      notes,
      organizationId: req.user.organizationId,
    },
    include: {
      position: { select: { id: true, name: true, color: true } },
      location: { select: { id: true, name: true } },
    },
  });
  res.status(201).json(template);
});

router.put('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { name, startTime, endTime, positionId, locationId, notes } = req.body;
  const template = await prisma.shiftTemplate.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(positionId !== undefined && { positionId: positionId || null }),
      ...(locationId !== undefined && { locationId: locationId || null }),
      ...(notes !== undefined && { notes }),
    },
    include: {
      position: { select: { id: true, name: true, color: true } },
      location: { select: { id: true, name: true } },
    },
  });
  res.json(template);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  await prisma.shiftTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
