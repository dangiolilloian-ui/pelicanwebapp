const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { notifyMany } = require('../lib/notify');

const router = Router();

// List messages for a channel
router.get('/', authenticate, async (req, res) => {
  const { channel = 'general', limit = 50 } = req.query;

  // Managers-only channel is gated at the read layer too — otherwise an
  // employee could just guess the slug and hit the endpoint directly.
  if (channel === 'managers' && req.user.role !== 'OWNER' && req.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const users = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  const messages = await prisma.message.findMany({
    where: { userId: { in: userIds }, channel },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: Number(limit),
  });

  res.json(messages.reverse());
});

// Slugify a location name into a channel key — lowercase, spaces/punct → dashes,
// collapse repeats, trim. Keeps channel names short and URL-safe while still
// being recognizable ("Morris Plains" → "morris-plains").
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// List channels.
//
// The channel list is derived from the org's locations rather than read from
// whatever rows happen to exist in `messages` — that way a brand-new store
// gets a thread on day one instead of only appearing after someone sends the
// first message. We also always include "general" for everyone and
// "managers" for OWNER/MANAGER roles.
router.get('/channels', authenticate, async (req, res) => {
  const [locations, users] = await Promise.all([
    prisma.location.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true },
    }),
  ]);
  const userIds = users.map((u) => u.id);

  const counts = await prisma.message.groupBy({
    by: ['channel'],
    where: { userId: { in: userIds } },
    _count: { id: true },
  });
  const countByName = new Map(counts.map((c) => [c.channel, c._count.id]));

  const channels = [
    { name: 'general', label: 'general', messageCount: countByName.get('general') || 0 },
  ];

  for (const loc of locations) {
    const name = slugify(loc.name);
    if (!name || channels.some((c) => c.name === name)) continue;
    channels.push({ name, label: loc.name, messageCount: countByName.get(name) || 0 });
  }

  if (req.user.role === 'OWNER' || req.user.role === 'MANAGER') {
    channels.push({ name: 'managers', label: 'managers', messageCount: countByName.get('managers') || 0 });
  }

  res.json(channels);
});

// Send message
router.post('/', authenticate, async (req, res) => {
  const { channel = 'general', content } = req.body;

  if (channel === 'managers' && req.user.role !== 'OWNER' && req.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const message = await prisma.message.create({
    data: { userId: req.user.id, channel, content },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Notification logic:
  // - @everyone or @channel  → notify every other org member
  // - @FirstName or @FirstLast → notify matching users
  // - otherwise, no notification (avoid spamming every message)
  try {
    const orgMembers = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId, id: { not: req.user.id } },
      select: { id: true, firstName: true, lastName: true },
    });

    const lc = content.toLowerCase();
    let targetIds = [];

    if (/@everyone\b|@channel\b|@here\b/.test(lc)) {
      targetIds = orgMembers.map((u) => u.id);
    } else {
      const mentionTokens = Array.from(content.matchAll(/@([A-Za-z][A-Za-z\-]*)/g)).map((m) => m[1].toLowerCase());
      if (mentionTokens.length > 0) {
        targetIds = orgMembers
          .filter((u) => {
            const fn = u.firstName.toLowerCase();
            const ln = u.lastName.toLowerCase();
            const full = `${fn}${ln}`;
            return mentionTokens.some((t) => t === fn || t === ln || t === full);
          })
          .map((u) => u.id);
      }
    }

    if (targetIds.length > 0) {
      const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;
      await notifyMany(targetIds, {
        type: 'MESSAGE',
        title: `${message.user.firstName} ${message.user.lastName} mentioned you in #${channel}`,
        body: preview,
        link: '/dashboard/messages',
      });
    }
  } catch (err) {
    console.error('Message notification failed:', err);
  }

  res.status(201).json(message);
});

module.exports = router;
