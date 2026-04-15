const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

// All endpoints here are manager-only — employee notes are an internal
// notebook, not a system the employee can see. We scope every read/write
// by verifying the target user is in the same organization.
router.use(authenticate, requireRole('OWNER', 'MANAGER'));

async function ensureSameOrg(req, targetUserId) {
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { organizationId: true },
  });
  return target && target.organizationId === req.user.organizationId;
}

router.get('/:userId', async (req, res) => {
  if (!(await ensureSameOrg(req, req.params.userId))) {
    return res.status(404).json({ error: 'User not found' });
  }
  const notes = await prisma.employeeNote.findMany({
    where: { userId: req.params.userId },
    orderBy: { createdAt: 'desc' },
  });

  // Hydrate author labels manually (no FK relation) so removing a manager
  // doesn't break the notes they wrote.
  const authorIds = [...new Set(notes.map((n) => n.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const aMap = new Map(authors.map((a) => [a.id, a]));
  res.json(notes.map((n) => ({ ...n, author: aMap.get(n.authorId) || null })));
});

router.post('/:userId', async (req, res) => {
  if (!(await ensureSameOrg(req, req.params.userId))) {
    return res.status(404).json({ error: 'User not found' });
  }
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'body required' });
  const note = await prisma.employeeNote.create({
    data: {
      userId: req.params.userId,
      authorId: req.user.id,
      body: body.trim(),
    },
  });
  // Look up the author now so the client doesn't need a second round trip
  // just to render the byline (the JWT payload shape isn't guaranteed).
  const author = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, firstName: true, lastName: true },
  });
  res.status(201).json({ ...note, author });
});

router.delete('/:userId/:noteId', async (req, res) => {
  const note = await prisma.employeeNote.findUnique({ where: { id: req.params.noteId } });
  if (!note || note.userId !== req.params.userId) {
    return res.status(404).json({ error: 'Note not found' });
  }
  if (!(await ensureSameOrg(req, note.userId))) {
    return res.status(404).json({ error: 'Note not found' });
  }
  await prisma.employeeNote.delete({ where: { id: note.id } });
  res.status(204).end();
});

module.exports = router;
