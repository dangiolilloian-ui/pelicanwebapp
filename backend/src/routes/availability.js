const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = Router();

// Get availability for a user
router.get('/:userId', authenticate, async (req, res) => {
  const records = await prisma.availability.findMany({
    where: { userId: req.params.userId },
    orderBy: { dayOfWeek: 'asc' },
  });
  res.json(records);
});

// Get all availability for the org
router.get('/', authenticate, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const records = await prisma.availability.findMany({
    where: { userId: { in: userIds } },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ userId: 'asc' }, { dayOfWeek: 'asc' }],
  });
  res.json(records);
});

// Set availability (replace all for user)
router.put('/:userId', authenticate, async (req, res) => {
  const { userId } = req.params;
  const { entries } = req.body; // [{ dayOfWeek, startTime, endTime, available }]

  // Only self or manager
  if (req.user.id !== userId && req.user.role === 'EMPLOYEE') {
    return res.status(403).json({ error: 'Cannot edit other users availability' });
  }

  await prisma.availability.deleteMany({ where: { userId } });

  const created = await Promise.all(
    entries.map((e) =>
      prisma.availability.create({
        data: { userId, dayOfWeek: e.dayOfWeek, startTime: e.startTime, endTime: e.endTime, available: e.available },
      })
    )
  );

  res.json(created);
});

module.exports = router;
