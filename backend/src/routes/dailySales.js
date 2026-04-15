const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// Same trick as holidays — strip the time component so "2026-04-11" always
// maps to the same stored row regardless of the caller's timezone.
function parseDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

// GET /api/sales?start=YYYY-MM-DD&end=YYYY-MM-DD&locationId=...
// Lists sales rows in a range. Managers only — sales totals are sensitive
// and not something every cashier needs to see.
router.get('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { start, end, locationId } = req.query;
  const where = { organizationId: req.user.organizationId };

  if (start || end) {
    where.date = {};
    if (start) {
      const s = parseDate(start);
      if (s) where.date.gte = s;
    }
    if (end) {
      const e = parseDate(end);
      if (e) where.date.lte = e;
    }
  }
  if (locationId) where.locationId = String(locationId);

  const rows = await prisma.dailySales.findMany({
    where,
    orderBy: [{ date: 'desc' }, { locationId: 'asc' }],
    take: 500,
  });
  res.json(rows);
});

// POST /api/sales — upsert (locationId, date).  Re-submitting the same
// day just overwrites — managers typically enter the number once at close
// but edit it when the drawer count comes in a few minutes later.
router.post('/', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { locationId, date, amount, notes } = req.body;

  const parsed = parseDate(date);
  if (!parsed) return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) required' });
  if (!locationId) return res.status(400).json({ error: 'locationId required' });

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) {
    return res.status(400).json({ error: 'amount must be a non-negative number' });
  }

  // Cross-org guard — make sure the location belongs to the caller's org.
  const loc = await prisma.location.findUnique({ where: { id: locationId } });
  if (!loc || loc.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const row = await prisma.dailySales.upsert({
    where: { locationId_date: { locationId, date: parsed } },
    create: {
      organizationId: req.user.organizationId,
      locationId,
      date: parsed,
      amount: amt,
      notes: notes ? String(notes).slice(0, 500) : null,
      enteredById: req.user.id,
    },
    update: {
      amount: amt,
      notes: notes ? String(notes).slice(0, 500) : null,
      enteredById: req.user.id,
    },
  });

  res.status(201).json(row);
});

router.delete('/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.dailySales.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.dailySales.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
