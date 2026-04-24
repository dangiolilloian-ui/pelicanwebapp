const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { authenticate, requireRole, invalidateActiveCache } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { sendEmail, esc } = require('../lib/email');
const { canManageTarget } = require('../lib/userScope');

const router = Router();

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// List org members. Positions/locations are the employee's trained roles and
// home stores — used by the scheduling page to filter the roster.
//
// `?status=` query param:
//   active   (default) — only isActive=true users
//   inactive — only deactivated users (for the Team page "Deactivated" tab)
//   all      — both (rare — full audit/reporting views)
router.get('/', authenticate, async (req, res) => {
  const statusParam = (req.query.status || 'active').toString();
  let activeFilter;
  if (statusParam === 'inactive') activeFilter = { isActive: false };
  else if (statusParam === 'all') activeFilter = {};
  else activeFilter = { isActive: true };

  const users = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId, ...activeFilter },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, role: true,
      employmentType: true, weeklyHoursCap: true, pin: true, birthDate: true, isMinor: true,
      isActive: true,
      positions: { select: { id: true, name: true, color: true } },
      locations: { select: { id: true, name: true } },
    },
    orderBy: { firstName: 'asc' },
  });
  res.json(users);
});

// Current user's profile (self-service)
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, role: true,
      weeklyHoursCap: true, icalToken: true,
    },
  });
  res.json(user);
});

// Regenerate the iCal subscription token for the current user
router.post('/me/ical-token', authenticate, async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { icalToken: randomToken() },
    select: { icalToken: true },
  });
  res.json(user);
});

// Invite / create employee
router.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { email, firstName, lastName, phone, role, password, employmentType } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already exists' });
  }

  // If the manager didn't pass a password, mint a random placeholder hash
  // and generate a single-use invite token the employee will use to set
  // their own password. This is the default onboarding path.
  const invite = !password;
  const placeholder = invite ? crypto.randomBytes(32).toString('hex') : password;
  const passwordHash = await bcrypt.hash(placeholder, 10);

  const user = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      phone,
      role: role || 'EMPLOYEE',
      employmentType: employmentType || 'FULL_TIME',
      passwordHash,
      organizationId: req.user.organizationId,
    },
    select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, employmentType: true },
  });

  let inviteToken = null;
  if (invite) {
    const token = randomToken() + randomToken(); // 48 bytes -> 96 hex chars
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        // 7 day window — plenty for a manager to forward the link and an
        // employee to act without the link going stale.
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      },
    });
    inviteToken = token;
  }

  // Seed onboarding progress from the org template so every new hire
  // shows up on the manager's onboarding dashboard with a concrete list.
  // We skip this for non-employee roles — a manager/owner invite doesn't
  // need to clear uniform/POS/etc.
  if (user.role === 'EMPLOYEE') {
    try {
      const template = await prisma.onboardingTask.findMany({
        where: { organizationId: req.user.organizationId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      if (template.length > 0) {
        await prisma.onboardingProgress.createMany({
          data: template.map((t) => ({
            userId: user.id,
            taskId: t.id,
            title: t.title,
          })),
        });
      }
    } catch (err) {
      // Onboarding seeding is best-effort — don't block user creation if
      // the template hasn't been set up yet.
      console.error('[onboarding seed] failed:', err);
    }
  }

  await audit(req, 'USER_CREATE', 'USER', user.id,
    `Created user ${user.firstName} ${user.lastName} (${user.role})`,
    { email: user.email, role: user.role, invite });
  res.status(201).json({ ...user, inviteToken });
});

// Manager-triggered password reset. Generates a fresh single-use token for
// the target employee AND emails them the link directly. The raw token is
// also returned to the manager so the Team page can show the URL as a
// fallback (useful if the email doesn't arrive or they want to send it via
// another channel too).
router.post('/:id/reset-link', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, firstName: true, organizationId: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }
  const token = randomToken() + randomToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: target.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const resetUrl = `${appUrl}/reset/${token}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 16px">Set your Pelican password</h2>
      <p>Hi ${esc(target.firstName) || 'there'},</p>
      <p>A manager at your workplace sent you a link to set or reset your Pelican password. Click the button below to pick a new password. This link is good for 7 days.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Set password</a>
      </p>
      <p style="font-size:13px;color:#555">Or copy and paste this URL into your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="font-size:13px;color:#555">If you didn't expect this, you can safely ignore this email.</p>
    </div>
  `;
  const text = `Set your Pelican password\n\nHi ${target.firstName || 'there'},\n\nA manager sent you a link to set or reset your Pelican password. Open this link within 7 days to pick a new password:\n\n${resetUrl}\n\nIf you didn't expect this, you can safely ignore this email.`;

  // Fire and forget — don't make the manager wait on the SMTP roundtrip,
  // and don't fail the button click if delivery has a transient hiccup.
  // The returned token gives the manager a fallback anyway.
  let emailed = false;
  const sendResult = await sendEmail({
    to: target.email,
    subject: 'Set your Pelican password',
    html,
    text,
  });
  emailed = sendResult.ok && !sendResult.dev;

  res.status(201).json({ token, emailed, sentTo: target.email });
});

// Update user
router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { firstName, lastName, phone, role, employmentType, weeklyHoursCap, pin, birthDate, isMinor, positionIds, locationIds } = req.body;

  // Only the owner can change roles, and nobody can set OWNER
  if (role) {
    if (req.user.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only the owner can change roles' });
    }
    if (role === 'OWNER') {
      return res.status(400).json({ error: 'Cannot assign OWNER role' });
    }
    if (!['EMPLOYEE', 'MANAGER', 'ADMIN'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    // Prevent changing the owner's own role
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }
  }

  // Validate PIN format + uniqueness within org
  if (pin !== undefined && pin !== null && pin !== '') {
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { organizationId: true },
    });
    if (!target || target.organizationId !== req.user.organizationId) {
      return res.status(404).json({ error: 'User not found' });
    }
    const conflict = await prisma.user.findFirst({
      where: {
        organizationId: target.organizationId,
        pin,
        NOT: { id: req.params.id },
      },
      select: { id: true },
    });
    if (conflict) return res.status(409).json({ error: 'PIN already in use' });
  }

  // Guard against cross-org tag assignments — a manager could otherwise POST
  // another org's position/location IDs and attach them to their own user.
  if (Array.isArray(positionIds) && positionIds.length > 0) {
    const count = await prisma.position.count({
      where: { id: { in: positionIds }, organizationId: req.user.organizationId },
    });
    if (count !== positionIds.length) {
      return res.status(400).json({ error: 'Invalid positionIds' });
    }
  }
  if (Array.isArray(locationIds) && locationIds.length > 0) {
    const count = await prisma.location.count({
      where: { id: { in: locationIds }, organizationId: req.user.organizationId },
    });
    if (count !== locationIds.length) {
      return res.status(400).json({ error: 'Invalid locationIds' });
    }
  }

  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(firstName && { firstName }),
        ...(lastName && { lastName }),
        ...(phone !== undefined && { phone }),
        ...(role && { role }),
        ...(employmentType && ['FULL_TIME', 'PART_TIME'].includes(employmentType) && { employmentType }),
        ...(weeklyHoursCap !== undefined && {
          weeklyHoursCap: weeklyHoursCap === null || weeklyHoursCap === '' ? null : Number(weeklyHoursCap),
        }),
        ...(pin !== undefined && { pin: pin === '' || pin === null ? null : pin }),
        ...(birthDate !== undefined && {
          birthDate: birthDate === null || birthDate === '' ? null : new Date(birthDate),
        }),
        ...(isMinor !== undefined && { isMinor: !!isMinor }),
        // `set` replaces the whole tag list — pass [] to clear, omit to leave
        // alone. We intentionally don't merge because the UI sends the full
        // intended set (checked boxes) on every save.
        ...(Array.isArray(positionIds) && {
          positions: { set: positionIds.map((id) => ({ id })) },
        }),
        ...(Array.isArray(locationIds) && {
          locations: { set: locationIds.map((id) => ({ id })) },
        }),
      },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true, role: true,
        employmentType: true, weeklyHoursCap: true, pin: true, birthDate: true, isMinor: true,
        positions: { select: { id: true, name: true, color: true } },
        locations: { select: { id: true, name: true } },
      },
    });
    await audit(req, 'USER_UPDATE', 'USER', user.id,
      `Updated user ${user.firstName} ${user.lastName}${role ? ` → ${role}` : ''}`,
      { changes: { firstName, lastName, phone, role, weeklyHoursCap, pin: pin !== undefined ? (pin ? 'set' : 'cleared') : undefined } });

    // If positions or locations changed, sync structural conversation memberships
    if (Array.isArray(positionIds) || Array.isArray(locationIds)) {
      try {
        const structuralConvs = await prisma.conversation.findMany({
          where: { organizationId: req.user.organizationId, type: 'STRUCTURAL' },
          select: { id: true },
        });
        for (const conv of structuralConvs) {
          // Inline sync — compute target members and reconcile
          const filters = await prisma.conversationFilter.findMany({ where: { conversationId: conv.id } });
          const posFilterIds = filters.filter((f) => f.filterType === 'POSITION').map((f) => f.filterId);
          const locFilterIds = filters.filter((f) => f.filterType === 'LOCATION').map((f) => f.filterId);
          let w = { organizationId: req.user.organizationId };
          if (posFilterIds.length) w.positions = { some: { id: { in: posFilterIds } } };
          if (locFilterIds.length) w.locations = { some: { id: { in: locFilterIds } } };
          const targetUsers = await prisma.user.findMany({ where: w, select: { id: true } });
          const targetIds = targetUsers.map((u) => u.id);
          const current = await prisma.conversationMember.findMany({ where: { conversationId: conv.id }, select: { userId: true, id: true } });
          const currentIds = current.map((m) => m.userId);
          const toAdd = targetIds.filter((id) => !currentIds.includes(id));
          const toRemove = current.filter((m) => !targetIds.includes(m.userId));
          if (toAdd.length) await prisma.conversationMember.createMany({ data: toAdd.map((userId) => ({ conversationId: conv.id, userId })), skipDuplicates: true });
          if (toRemove.length) await prisma.conversationMember.deleteMany({ where: { id: { in: toRemove.map((m) => m.id) } } });
        }
      } catch (err) {
        console.error('[structural sync] failed:', err);
      }
    }

    res.json(user);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'PIN already in use' });
    }
    throw err;
  }
});

// Delete user
//
// Scope is enforced by canManageTarget: OWNER can remove anyone, ADMIN anyone
// non-OWNER, MANAGER only EMPLOYEEs in their managed locations. Previously this
// was OWNER-only, but the team page needs managers/admins to be able to clean
// up their own rosters without bouncing every request up to the owner.
router.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const scope = await canManageTarget(req.user, req.params.id);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const target = scope.target;

  try {
    await prisma.user.delete({ where: { id: req.params.id } });
  } catch (err) {
    // A hard delete will fail if the user has shifts, time entries, etc. that
    // lack ON DELETE CASCADE. Point the caller at deactivate instead — it's
    // almost always what they actually want anyway.
    if (err.code === 'P2003' || err.code === 'P2014') {
      return res.status(409).json({
        error: 'This user has historical records (shifts, time entries, etc.) and can\'t be hard-deleted. Deactivate them instead.',
        code: 'HAS_REFERENCES',
      });
    }
    throw err;
  }

  await audit(req, 'USER_DELETE', 'USER', req.params.id,
    `Deleted user ${target.firstName} ${target.lastName}`,
    { email: target.email, role: target.role });
  invalidateActiveCache(req.params.id);
  res.status(204).end();
});

// Deactivate a user (soft-delete). They keep their record — shifts, time
// entries, audit history all stay — but they can't log in and they're hidden
// from scheduling/rosters. Reverse with POST /:id/activate.
router.post('/:id/deactivate', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const scope = await canManageTarget(req.user, req.params.id);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const target = scope.target;

  if (target.isActive === false) {
    return res.status(400).json({ error: 'User is already deactivated' });
  }

  await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });

  await audit(req, 'USER_DEACTIVATE', 'USER', req.params.id,
    `Deactivated ${target.firstName} ${target.lastName}`,
    { email: target.email, role: target.role });

  // Drop the cached "is active" flag so any live session this user has stops
  // working on the very next request instead of having to wait out the TTL.
  invalidateActiveCache(req.params.id);

  res.json({ ok: true, id: req.params.id, isActive: false });
});

// Reactivate a previously-deactivated user. Brings them back into schedule
// visibility and lets them log in again. Same scope rules as deactivate.
router.post('/:id/activate', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const scope = await canManageTarget(req.user, req.params.id);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  const target = scope.target;

  if (target.isActive === true) {
    return res.status(400).json({ error: 'User is already active' });
  }

  await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: true },
  });

  await audit(req, 'USER_ACTIVATE', 'USER', req.params.id,
    `Reactivated ${target.firstName} ${target.lastName}`,
    { email: target.email, role: target.role });

  invalidateActiveCache(req.params.id);

  res.json({ ok: true, id: req.params.id, isActive: true });
});

module.exports = router;
