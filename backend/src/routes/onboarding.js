const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// --- Template CRUD (org-scoped) ---
//
// GET /template — list all tasks in the org template
// POST /template — add a task (manager-only)
// PUT /template/:id — rename/reorder
// DELETE /template/:id — remove from template (existing per-user progress
//   rows are kept intact — we denormalize title, so we don't lose history)

router.get('/template', authenticate, async (req, res) => {
  const tasks = await prisma.onboardingTask.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json(tasks);
});

router.post('/template', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const { title, description, sortOrder } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title required' });
  const task = await prisma.onboardingTask.create({
    data: {
      organizationId: req.user.organizationId,
      title: title.trim(),
      description: description?.trim() || null,
      sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
    },
  });
  res.status(201).json(task);
});

router.put('/template/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.onboardingTask.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  const { title, description, sortOrder } = req.body;
  const updated = await prisma.onboardingTask.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title: String(title).trim() }),
      ...(description !== undefined && { description: description ? String(description).trim() : null }),
      ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) || 0 }),
    },
  });
  res.json(updated);
});

router.delete('/template/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const existing = await prisma.onboardingTask.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }
  await prisma.onboardingTask.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});

// --- Per-user progress ---
//
// GET  /users/:id — progress rows for one user. Self or manager.
// POST /users/:id/seed — create missing progress rows from the current
//   template. Safe to call multiple times (skips existing entries).
// PUT  /progress/:id — mark complete/incomplete, set notes. Manager-only,
//   because onboarding isn't self-serve.
//
// GET  /pending — manager digest: every user in the org with at least one
//   incomplete progress row, plus counts. The dashboard uses this.

router.get('/users/:id', authenticate, async (req, res) => {
  if (req.params.id !== req.user.id && req.user.role === 'EMPLOYEE') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }
  const rows = await prisma.onboardingProgress.findMany({
    where: { userId: req.params.id },
    orderBy: { createdAt: 'asc' },
  });
  res.json(rows);
});

router.post('/users/:id/seed', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'User not found' });
  }

  const template = await prisma.onboardingTask.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const existing = await prisma.onboardingProgress.findMany({
    where: { userId: req.params.id },
    select: { taskId: true },
  });
  const haveTaskIds = new Set(existing.map((e) => e.taskId));

  const toCreate = template.filter((t) => !haveTaskIds.has(t.id));
  if (toCreate.length === 0) return res.json({ created: 0 });

  await prisma.onboardingProgress.createMany({
    data: toCreate.map((t) => ({
      userId: req.params.id,
      taskId: t.id,
      title: t.title,
    })),
  });
  res.json({ created: toCreate.length });
});

router.put('/progress/:id', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  const row = await prisma.onboardingProgress.findUnique({ where: { id: req.params.id } });
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Cross-org guard via the target user.
  const target = await prisma.user.findUnique({
    where: { id: row.userId },
    select: { organizationId: true },
  });
  if (!target || target.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { completed, notes } = req.body;
  const updated = await prisma.onboardingProgress.update({
    where: { id: req.params.id },
    data: {
      ...(completed !== undefined && {
        completedAt: completed ? new Date() : null,
        completedById: completed ? req.user.id : null,
      }),
      ...(notes !== undefined && { notes: notes ? String(notes).slice(0, 500) : null }),
    },
  });
  res.json(updated);
});

router.get('/pending', authenticate, requireRole('OWNER', 'MANAGER'), async (req, res) => {
  // OnboardingProgress has no FK relation to User in the schema, so we
  // can't filter by `user.organizationId` directly. Fetch org users first,
  // then pull incomplete rows for those userIds.
  const orgUsers = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId },
    select: { id: true, firstName: true, lastName: true, createdAt: true },
  });
  const userMap = new Map(orgUsers.map((u) => [u.id, u]));
  if (orgUsers.length === 0) return res.json([]);

  const rows = await prisma.onboardingProgress.findMany({
    where: {
      completedAt: null,
      userId: { in: orgUsers.map((u) => u.id) },
    },
  });

  // Group by user so the UI gets a flat list of "{name}: 3 remaining".
  const byUser = new Map();
  for (const r of rows) {
    const u = userMap.get(r.userId);
    if (!u) continue;
    if (!byUser.has(u.id)) {
      byUser.set(u.id, {
        userId: u.id,
        name: `${u.firstName} ${u.lastName}`,
        hiredAt: u.createdAt,
        remaining: 0,
      });
    }
    byUser.get(u.id).remaining += 1;
  }

  // Sort by most recently hired — newer hires are more urgent to clear.
  const list = [...byUser.values()].sort((a, b) => new Date(b.hiredAt) - new Date(a.hiredAt));
  res.json(list);
});

module.exports = router;
