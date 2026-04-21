const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyMany } = require('../lib/notify');
const { getUserLocationIds } = require('../lib/locationAccess');

const router = Router();

// Hydrate author + location + position labels onto each announcement.
async function hydrate(rows, organizationId) {
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const locIds = [...new Set(rows.map((r) => r.locationId).filter(Boolean))];
  const posIds = [...new Set(rows.map((r) => r.positionId).filter(Boolean))];

  const [authors, locations, positions] = await Promise.all([
    authorIds.length
      ? prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [],
    locIds.length
      ? prisma.location.findMany({
          where: { id: { in: locIds }, organizationId },
          select: { id: true, name: true },
        })
      : [],
    posIds.length
      ? prisma.position.findMany({
          where: { id: { in: posIds }, organizationId },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const aMap = new Map(authors.map((a) => [a.id, a]));
  const lMap = new Map(locations.map((l) => [l.id, l]));
  const pMap = new Map(positions.map((p) => [p.id, p]));

  return rows.map((r) => ({
    ...r,
    author: aMap.get(r.authorId) || null,
    location: r.locationId ? lMap.get(r.locationId) || null : null,
    position: r.positionId ? pMap.get(r.positionId) || null : null,
  }));
}

// Determine which announcements a user should see based on their location
// and position assignments.
function filterForUser(rows, userLocationIds, userPositionIds) {
  return rows.filter((r) => {
    // Org-wide (no targeting) — everyone sees it
    if (!r.locationId && !r.positionId) return true;
    // Location-targeted
    if (r.locationId && !userLocationIds.includes(r.locationId)) return false;
    // Position-targeted
    if (r.positionId && !userPositionIds.includes(r.positionId)) return false;
    return true;
  });
}

router.get('/', authenticate, async (req, res) => {
  const now = new Date();
  const isManager = ['OWNER', 'ADMIN', 'MANAGER'].includes(req.user.role);
  const where = { organizationId: req.user.organizationId };

  // For employees, only filter out expired announcements (not un-pinned ones).
  // The dedicated page shows all; the dashboard bar filters client-side.
  if (!isManager) {
    where.OR = [{ expiresAt: null }, { expiresAt: { gte: now } }];
  }

  const rows = await prisma.announcement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });

  // Scope visibility: non-owners only see announcements for their locations
  // and positions (plus org-wide ones with no targeting).
  let visible = rows;
  if (!isManager) {
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        locations: { select: { id: true } },
        positions: { select: { id: true } },
      },
    });
    const userLocIds = dbUser?.locations.map((l) => l.id) || [];
    const userPosIds = dbUser?.positions.map((p) => p.id) || [];
    visible = filterForUser(rows, userLocIds, userPosIds);
  }

  // Ack counts + per-user state
  const ids = visible.map((r) => r.id);
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

  // Audience count — for targeted announcements, count users at that
  // location/position; for org-wide, count all org users minus author.
  const orgUserCount = await prisma.user.count({
    where: { organizationId: req.user.organizationId },
  });

  const hydrated = await hydrate(visible, req.user.organizationId);

  res.json(
    hydrated.map((r) => ({
      ...r,
      ackCount: ackCountMap.get(r.id) || 0,
      totalAudience: Math.max(0, orgUserCount - 1),
      ackedByMe: ackedByMe.has(r.id),
    }))
  );
});

// Employee taps "Got it" to acknowledge.
router.post('/:id/ack', authenticate, async (req, res) => {
  const ann = await prisma.announcement.findUnique({
    where: { id: req.params.id },
    select: { organizationId: true, authorId: true },
  });
  if (!ann || ann.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
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
  const { title, body, pinned, expiresAt, locationId, positionId } = req.body;
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
      locationId: locationId || null,
      positionId: positionId || null,
    },
  });

  // Build recipient list based on targeting
  let recipientWhere = {
    organizationId: req.user.organizationId,
    id: { not: req.user.id },
  };

  // If location-targeted, only notify users at that location
  if (locationId) {
    recipientWhere.locations = { some: { id: locationId } };
  }
  // If position-targeted, only notify users with that position
  if (positionId) {
    recipientWhere.positions = { some: { id: positionId } };
  }

  const recipients = await prisma.user.findMany({
    where: recipientWhere,
    select: { id: true },
  });

  await notifyMany(recipients.map((r) => r.id), {
    type: 'ANNOUNCEMENT',
    title: `📢 ${title}`,
    body: body.length > 140 ? body.slice(0, 137) + '...' : body,
    link: '/dashboard/announcements',
  });

  const [hydrated] = await hydrate([ann], req.user.organizationId);
  res.status(201).json(hydrated);
});

router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { title, body, pinned, expiresAt, locationId, positionId } = req.body;
  const ann = await prisma.announcement.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(body !== undefined && { body }),
      ...(pinned !== undefined && { pinned: !!pinned }),
      ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
      ...(locationId !== undefined && { locationId: locationId || null }),
      ...(positionId !== undefined && { positionId: positionId || null }),
    },
  });
  const [hydrated] = await hydrate([ann], req.user.organizationId);
  res.json(hydrated);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
