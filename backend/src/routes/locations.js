const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const locations = await prisma.location.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: { name: 'asc' },
  });
  res.json(locations);
});

const parseBudget = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { name, address, latitude, longitude, radiusMeters, weeklyBudget } = req.body;
  const location = await prisma.location.create({
    data: {
      name,
      address,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      ...(radiusMeters != null && { radiusMeters: Number(radiusMeters) }),
      weeklyBudget: parseBudget(weeklyBudget) ?? null,
      organizationId: req.user.organizationId,
    },
  });
  res.status(201).json(location);
});

router.put('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { name, address, latitude, longitude, radiusMeters, weeklyBudget } = req.body;
  const budget = parseBudget(weeklyBudget);
  const location = await prisma.location.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(address !== undefined && { address }),
      ...(latitude !== undefined && {
        latitude: latitude === null || latitude === '' ? null : Number(latitude),
      }),
      ...(longitude !== undefined && {
        longitude: longitude === null || longitude === '' ? null : Number(longitude),
      }),
      ...(radiusMeters !== undefined && radiusMeters !== null && radiusMeters !== '' && {
        radiusMeters: Number(radiusMeters),
      }),
      ...(budget !== undefined && { weeklyBudget: budget }),
    },
  });
  res.json(location);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  await prisma.location.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
