const { Router } = require('express');
const crypto = require('crypto');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { DEFAULTS, getConfig } = require('../lib/attendancePoints');

const router = Router();

// GET /api/org/attendance-config — returns the effective config (defaults
// merged with overrides) plus the raw overrides for the editor.
router.get('/attendance-config', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
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

// GET /api/org/invite-code — returns the current invite code for this org.
// Generates one on the fly if none exists yet.
router.get('/invite-code', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  let org = await prisma.organization.findUnique({
    where: { id: req.user.organizationId },
    select: { inviteCode: true, name: true },
  });
  if (!org.inviteCode) {
    const code = crypto.randomBytes(6).toString('hex'); // 12 char hex string
    org = await prisma.organization.update({
      where: { id: req.user.organizationId },
      data: { inviteCode: code },
      select: { inviteCode: true, name: true },
    });
  }
  res.json({ inviteCode: org.inviteCode });
});

// POST /api/org/invite-code/regenerate — invalidates the old code and creates
// a fresh one. Anyone with the old link won't be able to join anymore.
router.post('/invite-code/regenerate', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const code = crypto.randomBytes(6).toString('hex');
  const org = await prisma.organization.update({
    where: { id: req.user.organizationId },
    data: { inviteCode: code },
    select: { inviteCode: true },
  });
  await audit(req, 'INVITE_CODE_REGENERATE', 'ORG', req.user.organizationId,
    'Regenerated employee invite code');
  res.json({ inviteCode: org.inviteCode });
});

// ─── Department manager assignments ──────────────────────────────

// GET /api/org/dept-managers — returns positions & locations with their assigned managers
router.get('/dept-managers', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const orgId = req.user.organizationId;

  const positions = await prisma.position.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      color: true,
      managers: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: { name: 'asc' },
  });

  const locations = await prisma.location.findMany({
    where: { organizationId: orgId },
    select: {
      id: true,
      name: true,
      managers: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
    orderBy: { name: 'asc' },
  });

  res.json({ positions, locations });
});

// PUT /api/org/dept-managers/position/:positionId — set managers for a position
router.put('/dept-managers/position/:positionId', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { managerIds } = req.body; // string[]
  const orgId = req.user.organizationId;

  // Verify position belongs to org
  const pos = await prisma.position.findUnique({ where: { id: req.params.positionId }, select: { organizationId: true } });
  if (!pos || pos.organizationId !== orgId) return res.status(404).json({ error: 'Position not found' });

  // Verify all managers belong to org and are manager+
  if (managerIds && managerIds.length > 0) {
    const valid = await prisma.user.findMany({
      where: { id: { in: managerIds }, organizationId: orgId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
      select: { id: true },
    });
    if (valid.length !== managerIds.length) return res.status(400).json({ error: 'Some users are not valid managers' });
  }

  await prisma.position.update({
    where: { id: req.params.positionId },
    data: { managers: { set: (managerIds || []).map((id) => ({ id })) } },
  });

  await audit(req, 'DEPT_MANAGER_UPDATE', 'POSITION', req.params.positionId,
    `Updated department managers for position`, { managerIds });

  res.json({ ok: true });
});

// PUT /api/org/dept-managers/location/:locationId — set managers for a location
router.put('/dept-managers/location/:locationId', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { managerIds } = req.body; // string[]
  const orgId = req.user.organizationId;

  // Verify location belongs to org
  const loc = await prisma.location.findUnique({ where: { id: req.params.locationId }, select: { organizationId: true } });
  if (!loc || loc.organizationId !== orgId) return res.status(404).json({ error: 'Location not found' });

  if (managerIds && managerIds.length > 0) {
    const valid = await prisma.user.findMany({
      where: { id: { in: managerIds }, organizationId: orgId, role: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
      select: { id: true },
    });
    if (valid.length !== managerIds.length) return res.status(400).json({ error: 'Some users are not valid managers' });
  }

  await prisma.location.update({
    where: { id: req.params.locationId },
    data: { managers: { set: (managerIds || []).map((id) => ({ id })) } },
  });

  await audit(req, 'DEPT_MANAGER_UPDATE', 'LOCATION', req.params.locationId,
    `Updated department managers for location`, { managerIds });

  res.json({ ok: true });
});

module.exports = router;
