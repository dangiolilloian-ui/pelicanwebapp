const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyMany } = require('../lib/notify');

const router = Router();

// List announcements for the org. Employees only see pinned + non-expired
// ones; managers see everything for admin purposes.
router.get('/', authenticate, async (req, res) => {
  const now = new Date();
  const isManager = req.user.role === 'OWNER' || req.user.role === 'MANAGER';
  const where = { organizationId: req.user.organizationId };
  if (!isManager) {
    where.pinned = true;
    where.OR = [{ expiresAt: null }, { expiresAt: { gte: now } }];
  }
  const rows = await prisma.announcement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  // Hydrate author labels manually (no FK relation to User to keep the model
  // survivable when a manager leaves the org).
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const aMap = new Map(authors.map((a) => [a.id, a]));

  // Acknowledgement counts + per-user ack state. We always return
  // `ackedByMe` so the employee card knows whether to show "Got it" or
  // the green check. Managers additionally get `ackCount` + `totalAudience`
  // to render a read-through pill on each card.
  const ids = rows.map((r) => r.id);
  const acks = ids.length
    ? await prisma.announcementAck.findMany({
        where: { announcementId: { in: ids } },
        select: { announcementId: true, userId: true },
      })
    : [];
  const ackCountMap = new Map();
  const ackedByMe = new Set();
  for (const a of acks) {
    ackCountMap.set(a.announcementId, (ackCountMap.get(a.announcementId) || 0) + 1);
    if (a.userId === req.user.id) ackedByMe.add(a.announcementId);
  }
  // Audience = everyone in the org except the author (author doesn't need
  // to ack their own post). Approximate as orgUsers-1 to avoid an extra
  // query per announcement; close enough for a progress pill.
  const orgUserCount = await prisma.user.count({
    where: { organizationId: req.user.organizationId },
  });

  res.json(
    rows.map((r) => ({
      ...r,
      author: aMap.get(r.authorId) || null,
      ackCount: ackCountMap.get(r.id) || 0,
      totalAudience: Math.max(0, orgUserCount - 1),
      ackedByMe: ackedByMe.has(r.id),
    }))
  );
});

// Employee taps "Got it" to acknowledge. Idempotent — tapping twice is a
// no-op thanks to the unique (announcementId, userId) constraint.
router.post('/:id/ack', authenticate, async (req, res) => {
  const ann = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { organizationId: true, authorId: true },
  });
  if (!ann || ann.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  // Authors acking their own post is silly but harmless; we block it so
  // ack counts reflect actual reach.
  if (ann.authorId === req.user.id) {
    return res.status(400).json({ error: 'Cannot ack your own announcement' });
  }
  await prisma.announcementAck.upsert({
    where: {
      announcementId_userId: {
        announcementId: req.params.id,
        userId: req.user.id,
      },
    },
    update: {},
    create: {
      announcementId: req.params.id,
      userId: req.user.id,
    },
  });
  res.status(204).end();
});

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { title, body, pinned, expiresAt } = req.body;
  if (!title || !body) {
    return res.status(400).json({ error: 'title and body required' });
  }
  const ann = await prisma.announcement.create({
    data: {
      organizationId: req.user.organizationId,
      authorId: req.user.id,
      title,
      body,
      pinned: pinned !== false,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });

  // Notify everyone in the org (except the author) — reuses the in-app bell
  // system. Once we add Web Push this automatically becomes a real push.
  const recipients = await prisma.user.findMany({
    where: {
      organizationId: req.user.organizationId,
      id: { not: req.user.id },
    },
    select: { id: true },
  });
  await notifyMany(recipients.map((r) => r.id), {
    type: 'ANNOUNCEMENT',
    title: `📢 ${title}`,
    body: body.length > 140 ? body.slice(0, 137) + '...' : body,
    link: '/dashboard',
  });

  res.status(201).json(ann);
});

router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { title, body, pinned, expiresAt } = req.body;
  const ann = await prisma.announcement.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(body !== undefined && { body }),
      ...(pinned !== undefined && { pinned: !!pinned }),
      ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
    },
  });
  res.json(ann);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
