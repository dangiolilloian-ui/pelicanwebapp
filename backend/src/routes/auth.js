const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');

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

// Get current user
router.get('/me', authenticate, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, phone: true, organizationId: true },
  });
  res.json(user);
});


// --- Password reset / invite flow ---
// Tokens are minted elsewhere (by managers via /api/users/:id/reset-link or
// automatically on user creation). These two endpoints are public:
//   GET  /auth/password-reset/:token — validate + return who it's for
//   POST /auth/password-reset        — consume + set new password

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

module.exports = router;
