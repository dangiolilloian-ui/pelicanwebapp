const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.get('/', authenticate, async (req, res) => {
  const positions = await prisma.position.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: { name: 'asc' },
  });
  res.json(positions);
});

const MIN_WAGE = 16;

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { name, color, hourlyRate } = req.body;
  const rate = hourlyRate != null ? Math.max(Number(hourlyRate), MIN_WAGE) : MIN_WAGE;
  const position = await prisma.position.create({
    data: {
      name,
      color: color || '#6366f1',
      hourlyRate: rate,
      organizationId: req.user.organizationId,
    },
  });
  res.status(201).json(position);
});

router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { name, color, hourlyRate } = req.body;
  const rate = hourlyRate != null ? Math.max(Number(hourlyRate), MIN_WAGE) : undefined;
  const position = await prisma.position.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(color && { color }),
      ...(rate != null && { hourlyRate: rate }),
    },
  });
  res.json(position);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  await prisma.position.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
