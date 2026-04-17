const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyMany } = require('../lib/notify');

const router = Router();

// List incidents. Managers see all org incidents; employees see only theirs.
router.get('/', authenticate, async (req, res) => {
  const orgId = req.user.organizationId;
  const isManager = req.user.role === 'OWNER' || req.user.role === 'MANAGER';
  const where = { organizationId: orgId };
  if (!isManager) where.reporterId = req.user.id;

  const rows = await prisma.incident.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: 200,
  });

  // Hydrate reporter + resolver names in bulk.
  const userIds = [...new Set([
    ...rows.map((r) => r.reporterId),
    ...rows.map((r) => r.resolvedById).filter(Boolean),
  ])];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const uMap = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  // Hydrate location names.
  const locIds = [...new Set(rows.map((r) => r.locationId).filter(Boolean))];
  const locs = locIds.length
    ? await prisma.location.findMany({
        where: { id: { in: locIds } },
        select: { id: true, name: true },
      })
    : [];
  const lMap = new Map(locs.map((l) => [l.id, l.name]));

  res.json(rows.map((r) => ({
    ...r,
    reporterName: uMap.get(r.reporterId) || null,
    resolvedByName: r.resolvedById ? uMap.get(r.resolvedById) || null : null,
    locationName: r.locationId ? lMap.get(r.locationId) || null : null,
  })));
});

// File a new incident.
router.post('/', authenticate, async (req, res) => {
  const { title, description, severity, locationId, occurredAt } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'title and description required' });
  }
  const validSev = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  const sev = validSev.includes(severity) ? severity : 'LOW';

  const incident = await prisma.incident.create({
    data: {
      organizationId: req.user.organizationId,
      reporterId: req.user.id,
      locationId: locationId || null,
      severity: sev,
      title,
      description,
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    },
  });

  // Push managers so they see the incident immediately.
  const managers = await prisma.user.findMany({
    where: {
      organizationId: req.user.organizationId,
      role: { in: ['OWNER', 'MANAGER'] },
      id: { not: req.user.id },
    },
    select: { id: true },
  });
  if (managers.length > 0) {
    const reporter = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { firstName: true, lastName: true },
    });
    const who = reporter ? `${reporter.firstName} ${reporter.lastName}` : 'An employee';
    await notifyMany(managers.map((m) => m.id), {
      type: 'INCIDENT_REPORTED',
      title: `Incident: ${title}`,
      body: `${who} reported a ${sev.toLowerCase()} severity incident`,
      link: '/dashboard/incidents',
    });
  }

  res.status(201).json(incident);
});

// Resolve an incident (manager only).
router.put('/:id/resolve', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const inc = await prisma.incident.findUnique({ where: { id: req.params.id } });
  if (!inc || inc.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const updated = await prisma.incident.update({
    where: { id: req.params.id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedById: req.user.id,
      resolutionNote: req.body.note ? String(req.body.note).slice(0, 2000) : null,
    },
  });
  res.json(updated);
});

// Reopen a resolved incident (manager only).
router.put('/:id/reopen', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const inc = await prisma.incident.findUnique({ where: { id: req.params.id } });
  if (!inc || inc.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const updated = await prisma.incident.update({
    where: { id: req.params.id },
    data: {
      status: 'OPEN',
      resolvedAt: null,
      resolvedById: null,
      resolutionNote: null,
    },
  });
  res.json(updated);
});

module.exports = router;
