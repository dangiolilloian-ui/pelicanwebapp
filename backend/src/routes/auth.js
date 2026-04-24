const crypto = require('crypto');
const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { sendEmail, esc } = require('../lib/email');

// Helper — verify a 6-digit TOTP code against a base32 secret.  window:1
// means we accept the previous and next 30s window too, which covers the
// usual "user was staring at the wrong code" slop without widening the
// attack surface meaningfully.
function verifyTotp(secret, token) {
  if (!secret || !token) return false;
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(token).replace(/\s+/g, ''),
    window: 1,
  });
}

const router = Router();

// Hard cap on /auth/login to block credential stuffing.  We key on
// IP + submitted email so one attacker can't lock out every user from a
// single IP, and one user with a flaky keyboard doesn't lock a whole café
// out either.  5 attempts per 15 minutes is strict enough to make a
// dictionary attack useless and lax enough that a frustrated manager won't
// feel it.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'login',
  keyFn: (req) => `${req.ip}|${(req.body?.email || '').toLowerCase()}`,
});

// Password reset is less abuse-prone but still worth throttling so a
// malicious form-poster can't DOS the bcrypt path.  20/min per IP.
const resetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyPrefix: 'reset',
});

// Forgot-password is unauthenticated and costs an email send, so tighter:
// 5 requests per 15 minutes per IP. Also keyed by IP alone — we don't want
// to rate-limit by email (that would let an attacker rotate emails to
// probe which ones exist).
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'forgot',
});
const JWT_SECRET = process.env.JWT_SECRET;

// Register organization + owner
router.post('/register', async (req, res) => {
  try {
    const { organizationName, firstName, lastName, email, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const org = await prisma.organization.create({
      data: {
        name: organizationName,
        users: {
          create: {
            email,
            passwordHash,
            firstName,
            lastName,
            role: 'OWNER',
          },
        },
      },
      include: { users: true },
    });

    const user = org.users[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: org.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
//
// Two-step when 2FA is on:
//   1) Client POSTs { email, password }
//   2) If the user has TOTP enabled, server returns { requires2fa: true }
//      with no token — client then re-POSTs { email, password, totp }
//   3) Server verifies both and issues the JWT
//
// We re-check the password on step 2 rather than trusting a server-side
// session — keeps the login endpoint stateless and means a stolen
// "requires2fa" response can't be replayed into a token.
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password, totp } = req.body;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Block deactivated accounts before we hand out a token. We check this
    // AFTER verifying the password so a wrong guess on a deactivated email
    // still just looks like "invalid credentials" — avoids leaking whether
    // the account exists and is merely disabled.
    if (user.isActive === false) {
      return res.status(403).json({ error: 'Account deactivated', code: 'DEACTIVATED' });
    }

    if (user.totpEnabled) {
      if (!totp) {
        // Password was correct but we need the second factor. 200 +
        // a marker rather than 401 so the client can branch cleanly.
        return res.json({ requires2fa: true });
      }
      if (!verifyTotp(user.totpSecret, totp)) {
        return res.status(401).json({ error: 'Invalid authentication code' });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- 2FA setup flow ---
//
// GET  /auth/2fa/status        — is 2FA on for me?
// POST /auth/2fa/setup         — (re)generate a secret, return otpauth URL + QR
// POST /auth/2fa/enable        — verify first code, flip totpEnabled
// POST /auth/2fa/disable       — require password + code, wipe secret

router.get('/2fa/status', authenticate, async (req, res) => {
  const u = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { totpEnabled: true, totpSecret: true },
  });
  res.json({ enabled: !!u?.totpEnabled, pending: !u?.totpEnabled && !!u?.totpSecret });
});

router.post('/2fa/setup', authenticate, async (req, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { email: true, totpEnabled: true },
  });
  if (!me) return res.status(404).json({ error: 'User not found' });
  if (me.totpEnabled) {
    return res.status(400).json({ error: '2FA is already enabled. Disable it first to re-enroll.' });
  }

  // Fresh secret each setup call — if a user abandons setup halfway and
  // starts over, the old secret shouldn't keep working.
  const secret = speakeasy.generateSecret({
    name: `Pelican (${me.email})`,
    issuer: 'Pelican',
    length: 20,
  });

  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpSecret: secret.base32, totpEnabled: false },
  });

  // Render the QR as a data URL so the frontend can drop it straight into
  // an <img> tag — no client-side QR lib needed.
  const qrDataUrl = await QRCode.toDataURL(secret.otpauth_url);

  res.json({
    otpauthUrl: secret.otpauth_url,
    secret: secret.base32, // manual-entry fallback for apps without QR
    qrDataUrl,
  });
});

router.post('/2fa/enable', authenticate, async (req, res) => {
  const { totp } = req.body;
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!me?.totpSecret) return res.status(400).json({ error: 'Run setup first' });
  if (me.totpEnabled) return res.status(400).json({ error: 'Already enabled' });
  if (!verifyTotp(me.totpSecret, totp)) {
    return res.status(401).json({ error: 'Invalid code' });
  }
  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpEnabled: true },
  });
  res.json({ enabled: true });
});

router.post('/2fa/disable', authenticate, async (req, res) => {
  const { password, totp } = req.body;
  const me = await prisma.user.findUnique({
    where: { id: req.user.id },
  });
  if (!me) return res.status(404).json({ error: 'User not found' });

  // Require current password AND a valid code — otherwise a stolen session
  // cookie could silently strip 2FA.
  const valid = await bcrypt.compare(password || '', me.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid password' });
  if (me.totpEnabled && !verifyTotp(me.totpSecret, totp)) {
    return res.status(401).json({ error: 'Invalid code' });
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpSecret: null, totpEnabled: false },
  });
  res.json({ enabled: false });
});

// Get current user. We include managedLocations so the client-side scope
// check (canAct in the Team page) can hide buttons a manager would just get
// a 403 for. The backend is still the source of truth — this is pure UI.
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, email: true, firstName: true, lastName: true, role: true,
      phone: true, organizationId: true,
      locations: { select: { id: true, name: true } },
      managedLocations: { select: { id: true, name: true } },
    },
  });
  res.json(user);
});


// --- Password reset / invite flow ---
//   POST /auth/forgot-password       — request a reset link by email
//   GET  /auth/password-reset/:token — validate + return who it's for
//   POST /auth/password-reset        — consume + set new password

// POST /auth/forgot-password
// Accepts { email }. If a matching user exists, mint a PasswordResetToken
// and email a link. ALWAYS returns 200 regardless of whether the email
// exists — otherwise the endpoint leaks which addresses are registered.
router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const rawEmail = (req.body?.email || '').trim().toLowerCase();
  if (!rawEmail) return res.status(400).json({ error: 'Email required' });

  // Intentionally opaque success response — same shape whether or not the
  // email is a real account. Do NOT tell callers "no user found".
  const genericOk = { ok: true };

  const user = await prisma.user.findUnique({
    where: { email: rawEmail },
    select: { id: true, email: true, firstName: true, isActive: true },
  });
  // Deactivated accounts silently drop off the forgot-password flow — we
  // still return the generic "check your inbox" response so the endpoint
  // can't be used to discover which accounts are disabled.
  if (!user || user.isActive === false) return res.json(genericOk);

  // One reset token active at a time per user — invalidate prior unused
  // tokens so an attacker who got an old link can't use it after the user
  // requests a new one.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await prisma.passwordResetToken.create({
    data: { userId: user.id, token, expiresAt },
  });

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const resetUrl = `${appUrl}/reset/${token}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;color:#111">
      <h2 style="margin:0 0 16px">Reset your Pelican password</h2>
      <p>Hi ${esc(user.firstName) || 'there'},</p>
      <p>We got a request to reset the password for <strong>${esc(user.email)}</strong>. Click the button below to set a new one. This link is good for 24 hours.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">Reset password</a>
      </p>
      <p style="font-size:13px;color:#555">Or copy and paste this URL into your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
      <p style="font-size:13px;color:#555">If you didn't request this, you can safely ignore this email — your current password will stay active.</p>
    </div>
  `;
  const text = `Reset your Pelican password\n\nHi ${user.firstName || 'there'},\n\nWe got a request to reset the password for ${user.email}. Open this link within 24 hours to set a new one:\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;

  // Fire and forget as far as the API response goes — we don't want the
  // delivery status to leak whether the email existed either.
  sendEmail({ to: user.email, subject: 'Reset your Pelican password', html, text }).catch((e) => {
    console.error('[forgot-password] send failed', e);
  });

  res.json(genericOk);
});

router.get('/password-reset/:token', async (req, res) => {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token: req.params.token },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(410).json({ error: 'Link expired or already used' });
  }
  const user = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!user) return res.status(410).json({ error: 'Link expired or already used' });
  res.json({ email: user.email, firstName: user.firstName, lastName: user.lastName });
});

router.post('/password-reset', resetLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const record = await prisma.passwordResetToken.findUnique({ where: { token } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(410).json({ error: 'Link expired or already used' });
  }

  // Deactivated accounts can't consume a reset — pretend the link is stale
  // rather than revealing the account's disabled status. Same pattern as the
  // forgot-password endpoint.
  const targetUser = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { isActive: true },
  });
  if (!targetUser || targetUser.isActive === false) {
    return res.status(410).json({ error: 'Link expired or already used' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Transaction so marking the token as used and rotating the password
  // always commit together — otherwise a crash mid-way would leave a usable
  // token attached to a new password.
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  const jwtToken = jwt.sign(
    { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token: jwtToken,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
  });
});

// --- Self-service employee join ---
// Public endpoint. Employees visit /join/<inviteCode>, fill in their name,
// email, and password, and get added to the org as an EMPLOYEE. The code
// is a short random string stored on the organization row — managers can
// regenerate it from the Team page if they want to invalidate the old one.

// GET /auth/join/:code — validate code and return org name so the UI can
// display "Join <org>" before the employee fills in their details.
router.get('/join/:code', async (req, res) => {
  const org = await prisma.organization.findUnique({
    where: { inviteCode: req.params.code },
    select: { id: true, name: true },
  });
  if (!org) return res.status(404).json({ error: 'Invalid invite code' });
  res.json({ organizationName: org.name });
});

// POST /auth/join — create an EMPLOYEE account under the org that owns
// the supplied invite code.
router.post('/join', async (req, res) => {
  try {
    const { inviteCode, firstName, lastName, email, password, phone } = req.body;
    if (!inviteCode || !firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const org = await prisma.organization.findUnique({
      where: { inviteCode },
      select: { id: true, name: true },
    });
    if (!org) return res.status(404).json({ error: 'Invalid invite code' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        phone: phone || null,
        role: 'EMPLOYEE',
        organizationId: org.id,
      },
    });

    // Seed onboarding tasks if the org has a template
    try {
      const template = await prisma.onboardingTask.findMany({
        where: { organizationId: org.id },
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
      console.error('[onboarding seed] failed:', err);
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: org.id },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Join failed' });
  }
});

module.exports = router;
