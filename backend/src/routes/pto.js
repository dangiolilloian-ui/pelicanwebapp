const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const {
  DEFAULTS,
  getConfig,
  getBalance,
  getYtdAccrued,
  recordAdjust,
} = require('../lib/pto');

const router = Router();

// GET /pto/config — effective policy merged with defaults. Any authenticated
// user can read the numbers (they want to know how their accrual works).
router.get('/config', authenticate, async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { ptoConfig: true },
  });
  const effective = await getConfig(req.user.organizationId);
  res.json({ defaults: DEFAULTS, overrides: org?.ptoConfig || null, effective });
});

// PUT /pto/config — owner only. Whitelist numeric/boolean fields.
router.put('/config', authenticate, requireRole('OWNER'), async (req, res) => {
  const body = req.body || {};
  const clean = {};
  if (body.enabled !== undefined) clean.enabled = !!body.enabled;
  if (body.allowNegative !== undefined) clean.allowNegative = !!body.allowNegative;
  for (const k of ['accrualRatePerHour', 'annualCapHours']) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: `${k} must be a non-negative number` });
      }
      clean[k] = n;
    }
  }
  const overrides = Object.keys(clean).length ? clean : null;
  await prisma.organization.update({
    where: { id: req.user.organizationId },
    data: { ptoConfig: overrides },
  });
  await audit(req, 'PTO_CONFIG_UPDATE', 'ORG', req.user.organizationId,
    'Updated PTO policy', overrides || { reset: true });
  const effective = await getConfig(req.user.organizationId);
  res.json({ defaults: DEFAULTS, overrides, effective });
});

// GET /pto/balance — own balance or, for managers, any user in their org.
router.get('/balance', authenticate, async (req, res) => {
  const targetId = req.query.userId || req.user.id;
  if (targetId !== req.user.id && req.user.role !== 'OWNER' && req.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Cannot read other users\' balance' });
  }
  // Cross-org guard: make sure the target is actually in our org.
  if (targetId !== req.user.id) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { organizationId: true },
    });
    if (!target || target.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
  }
  const [balance, ytdAccrued, config] = await Promise.all([
    getBalance(targetId),
    getYtdAccrued(targetId),
    getConfig(req.user.organizationId),
  ]);
  res.json({
    userId: targetId,
    balance: Math.round(balance * 100) / 100,
    ytdAccrued: Math.round(ytdAccrued * 100) / 100,
    annualCap: config.annualCapHours,
    remainingAccrualHeadroom: Math.max(0, config.annualCapHours - ytdAccrued),
    enabled: config.enabled,
  });
});

// GET /pto/ledger?userId=...&limit=50 — history. Same access rules.
router.get('/ledger', authenticate, async (req, res) => {
  const targetId = req.query.userId || req.user.id;
  if (targetId !== req.user.id && req.user.role !== 'OWNER' && req.user.role !== 'MANAGER') {
    return res.status(403).json({ error: 'Cannot read other users\' ledger' });
  }
  if (targetId !== req.user.id) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { organizationId: true },
    });
    if (!target || target.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
  }
  const take = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = await prisma.ptoLedgerEntry.findMany({
    where: { userId: targetId },
    orderBy: { createdAt: 'desc' },
    take,
  });

  // Hydrate actor names manually so a deleted actor doesn't break history.
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  res.json(
    rows.map((r) => ({
      ...r,
      actor: r.actorId ? actorMap.get(r.actorId) || null : null,
    }))
  );
});

// POST /pto/adjust — manager-only. Body: { userId, delta, reason }.
router.post('/adjust', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { userId, delta, reason } = req.body;
  const d = Number(delta);
  if (!userId || !Number.isFinite(d) || d === 0) {
    return res.status(400).json({ error: 'userId and non-zero delta required' });
  }
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { organizationId: true, firstName: true, lastName: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }
  const entry = await recordAdjust(req.user.organizationId, userId, d, reason || null, req.user.id);
  await audit(req, 'PTO_ADJUST', 'USER', userId,
    `${d > 0 ? 'Granted' : 'Deducted'} ${Math.abs(d)}h PTO — ${target.firstName} ${target.lastName}`,
    { delta: d, reason });
  res.status(201).json(entry);
});

module.exports = router;
