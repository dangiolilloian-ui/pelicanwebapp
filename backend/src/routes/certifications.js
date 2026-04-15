const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// List certifications for the org (managers) or for myself (employees).
// `status` filter: 'expiring' returns only those within 30 days of expiry,
// 'expired' returns past-expiry ones, omitted returns everything visible.
router.get('/', authenticate, async (req, res) => {
  const isManager = req.user.role === 'OWNER' || req.user.role === 'MANAGER';
  const { status } = req.query;

  const where = isManager
    ? { user: { organizationId: req.user.organizationId } }
    : { userId: req.user.id };

  if (status === 'expiring') {
    const now = new Date();
    const cutoff = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
    where.expiresAt = { gte: now, lte: cutoff };
  } else if (status === 'expired') {
    where.expiresAt = { lt: new Date() };
  }

  const rows = await prisma.certification.findMany({
    where,
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ expiresAt: 'asc' }, { name: 'asc' }],
  });
  res.json(rows);
});

router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { userId, name, issuedAt, expiresAt, reference } = req.body;
  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and name required' });
  }
  // Confirm the target user is in the same org — stop cross-org writes even
  // if a manager guesses a uuid.
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }
  const cert = await prisma.certification.create({
    data: {
      userId,
      name,
      issuedAt: issuedAt ? new Date(issuedAt) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      reference: reference || null,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  res.status(201).json(cert);
});

router.put('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.certification.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { organizationId: true } } },
  });
  if (!existing || existing.user.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Certification not found' });
  }
  const { name, issuedAt, expiresAt, reference } = req.body;
  const cert = await prisma.certification.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(issuedAt !== undefined && { issuedAt: issuedAt ? new Date(issuedAt) : null }),
      ...(expiresAt !== undefined && { expiresAt: expiresAt ? new Date(expiresAt) : null }),
      ...(reference !== undefined && { reference: reference || null }),
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });
  res.json(cert);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.certification.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { organizationId: true } } },
  });
  if (!existing || existing.user.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Certification not found' });
  }
  await prisma.certification.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
