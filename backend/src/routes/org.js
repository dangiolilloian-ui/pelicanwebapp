const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { DEFAULTS, getConfig } = require('../lib/attendancePoints');

const router = Router();

// GET /api/org/attendance-config — returns the effective config (defaults
// merged with overrides) plus the raw overrides for the editor.
router.get('/attendance-config', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { attendanceConfig: true },
  });
  const effective = await getConfig(req.user.organizationId);
  res.json({ defaults: DEFAULTS, overrides: org?.attendanceConfig || null, effective });
});

// PUT /api/org/attendance-config — replaces the overrides object. Pass an
// empty object or null to revert to defaults. Owner-only since it affects
// disciplinary consequences.
router.put('/attendance-config', authenticate, requireRole('OWNER'), async (req, res) => {
  const body = req.body || {};
  // Whitelist keys — don't let arbitrary JSON in.
  const allowed = ['windowDays', 'lateMinutes', 'earlyOutMinutes', 'pointsNoShow', 'pointsLate', 'pointsEarlyOut', 'thresholdWarn', 'thresholdFinal'];
  const clean = {};
  for (const k of allowed) {
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
    data: { attendanceConfig: overrides },
  });
  await audit(req, 'ATTENDANCE_CONFIG_UPDATE', 'ORG', req.user.organizationId,
    'Updated attendance points policy', overrides || { reset: true });
  const effective = await getConfig(req.user.organizationId);
  res.json({ defaults: DEFAULTS, overrides, effective });
});

module.exports = router;
