const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = Router();

// List current user's notifications
router.get('/', authenticate, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(notifications);
});

// Unread count
router.get('/unread-count', authenticate, async (req, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.user.id, read: false },
  });
  res.json({ count });
});

// Mark one as read
router.put('/:id/read', authenticate, async (req, res) => {
  await prisma.notification.updateMany({
    where: { id: req.params.id, userId: req.user.id },
    data: { read: true },
  });
  res.status(204).end();
});

// Mark all as read
router.put('/read-all', authenticate, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true },
  });
  res.status(204).end();
});

// Delete one
router.delete('/:id', authenticate, async (req, res) => {
  await prisma.notification.deleteMany({
    where: { id: req.params.id, userId: req.user.id },
  });
  res.status(204).end();
});

module.exports = router;
