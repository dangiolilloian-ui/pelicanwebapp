const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { computeCoverageGaps } = require('../lib/coverage');

const router = Router();

// All endpoints here are manager-level. Employees don't need to know the
// coverage policy and the gap report is sensitive scheduling info.
router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));

// GET /coverage/requirements — list org requirements
router.get('/requirements', async (req, res) => {
  const rows = await prisma.coverageRequirement.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });

  // Hydrate location names so the UI doesn't have to re-query
  const locationIds = [...new Set(rows.map((r) => r.locationId).filter(Boolean))];
  const locations = locationIds.length
    ? await prisma.location.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, name: true },
      })
    : [];
  const locMap = new Map(locations.map((l) => [l.id, l]));

  res.json(
    rows.map((r) => ({
      ...r,
      location: r.locationId ? locMap.get(r.locationId) || null : null,
    }))
  );
});

// POST /coverage/requirements — create
router.post('/requirements', async (req, res) => {
  const { locationId, dayOfWeek, startTime, endTime, minStaff, notes } = req.body;
  if (dayOfWeek == null || !startTime || !endTime || !minStaff) {
    return res.status(400).json({ error: 'dayOfWeek, startTime, endTime, minStaff required' });
  }
  const staff = parseInt(minStaff, 10);
  if (!Number.isFinite(staff) || staff < 1) {
    return res.status(400).json({ error: 'minStaff must be ≥ 1' });
  }

  // Validate location belongs to the requester's org when given.
  if (locationId) {
    const loc = await prisma.location.findUnique({ where: { id: locationId }, select: { organizationId: true } });
    if (!loc || loc.organizationId !== req.user.organizationId) {
      return res.status(400).json({ error: 'Invalid location' });
    }
  }

  const row = await prisma.coverageRequirement.create({
    data: {
      organizationId: req.user.organizationId,
      locationId: locationId || null,
      dayOfWeek: Number(dayOfWeek),
      startTime,
      endTime,
      minStaff: staff,
      notes: notes || null,
    },
  });
  await audit(req, 'COVERAGE_CREATE', 'COVERAGE', row.id,
    `Created coverage rule (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][row.dayOfWeek]} ${row.startTime}-${row.endTime}, min ${row.minStaff})`,
    row);
  res.status(201).json(row);
});

// PUT /coverage/requirements/:id — update
router.put('/requirements/:id', async (req, res) => {
  const existing = await prisma.coverageRequirement.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { locationId, dayOfWeek, startTime, endTime, minStaff, notes } = req.body;
  const row = await prisma.coverageRequirement.update({
    where: { id: req.params.id },
    data: {
      ...(locationId !== undefined && { locationId: locationId || null }),
      ...(dayOfWeek !== undefined && { dayOfWeek: Number(dayOfWeek) }),
      ...(startTime !== undefined && { startTime }),
      ...(endTime !== undefined && { endTime }),
      ...(minStaff !== undefined && { minStaff: parseInt(minStaff, 10) }),
      ...(notes !== undefined && { notes: notes || null }),
    },
  });
  res.json(row);
});

// DELETE /coverage/requirements/:id
router.delete('/requirements/:id', async (req, res) => {
  const existing = await prisma.coverageRequirement.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.coverageRequirement.delete({ where: { id: req.params.id } });
  await audit(req, 'COVERAGE_DELETE', 'COVERAGE', req.params.id,
    `Deleted coverage rule`, existing);
  res.status(204).end();
});

// GET /coverage/gaps?start=...&end=...&includeDrafts=true
// Returns the list of unmet requirement slots over the range.
router.get('/gaps', async (req, res) => {
  const { start, end, includeDrafts } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });
  const gaps = await computeCoverageGaps({
    organizationId: req.user.organizationId,
    rangeStart: new Date(start),
    rangeEnd: new Date(end),
    includeDrafts: includeDrafts !== 'false',
  });
  res.json(gaps);
});

module.exports = router;
