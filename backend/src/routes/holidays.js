const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// Parse "YYYY-MM-DD" into a UTC Date pinned at midnight. Holidays are stored
// as plain DATE, so we deliberately drop any time component the client sends.
function parseDate(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d.getTime()) ? null : d;
}

// List holidays. Everyone in the org can read — employees need to know which
// days pay extra too. Optional ?year= filter because the table will grow
// across years and the UI usually only wants the current one.
router.get('/', authenticate, async (req, res) => {
  const where = { organizationId: req.user.organizationId };
  if (req.query.year) {
    const y = Number(req.query.year);
    if (Number.isInteger(y)) {
      where.date = {
        gte: new Date(Date.UTC(y, 0, 1)),
        lt: new Date(Date.UTC(y + 1, 0, 1)),
      };
    }
  }
  const holidays = await prisma.holiday.findMany({
    where,
    orderBy: { date: 'asc' },
  });
  res.json(holidays);
});

router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { date, name } = req.body;
  const parsed = parseDate(date);
  if (!parsed) return res.status(400).json({ error: 'Valid date (YYYY-MM-DD) required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const holiday = await prisma.holiday.create({
      data: {
        organizationId: req.user.organizationId,
        date: parsed,
        name: name.trim(),
      },
    });
    res.status(201).json(holiday);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A holiday already exists for that date' });
    }
    throw err;
  }
});

router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const existing = await prisma.holiday.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { date, name } = req.body;
  const data = {};
  if (date !== undefined) {
    const parsed = parseDate(date);
    if (!parsed) return res.status(400).json({ error: 'Valid date required' });
    data.date = parsed;
  }
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'Name required' });
    data.name = name.trim();
  }
  try {
    const updated = await prisma.holiday.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A holiday already exists for that date' });
    }
    throw err;
  }
});

router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const existing = await prisma.holiday.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.holiday.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

module.exports = router;
