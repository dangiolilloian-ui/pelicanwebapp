const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));

// Build the common `where` clause so GET / and GET /export stay in sync.
// Keeping this in one place avoids the classic bug where export silently
// pulls a different dataset than what the user sees on screen.
function buildWhere(req) {
  const { entityType, entityId, action, actorId, q, from, to } = req.query;
  const where = { organizationId: req.user.organizationId };
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (action) where.action = action;
  if (actorId) where.actorId = actorId;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    // `to` is inclusive-by-day: a user picking 2026-04-11 wants to include
    // entries up to 23:59:59 of that date, not cut off at midnight.
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.createdAt.lte = end;
    }
  }
  if (q) {
    where.OR = [
      { summary: { contains: q, mode: 'insensitive' } },
      { action: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

// Batch-hydrate actor names — no FK on auditLog.actorId so deleted users
// don't break historical entries.
async function hydrateActors(rows) {
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  if (!actorIds.length) return rows.map((r) => ({ ...r, actor: null }));
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const actorMap = new Map(actors.map((a) => [a.id, a]));
  return rows.map((r) => ({
    ...r,
    actor: r.actorId ? actorMap.get(r.actorId) || null : null,
  }));
}

// GET /audit-logs?entityType=&action=&actorId=&q=&from=&to=&limit=&offset=
// Paginated by createdAt desc. The UI uses offset pagination rather than
// cursor because the filter bar's "jump to page N" is a more common flow
// than infinite scroll for an audit log.
router.get('/', async (req, res) => {
  const take = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const skip = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const where = buildWhere(req);

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  res.json({ entries: await hydrateActors(rows), total, limit: take, offset: skip });
});

// GET /audit-logs/facets
// Returns the distinct actions, entity types, and actors that actually
// exist in this org's audit log — so the filter dropdowns only show
// options that will return results. Scoped to the last 90 days to keep
// the option list tight and the query cheap.
router.get('/facets', async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: req.user.organizationId, createdAt: { gte: since } },
    select: { action: true, entityType: true, actorId: true },
  });
  const actions = [...new Set(rows.map((r) => r.action))].sort();
  const entityTypes = [...new Set(rows.map((r) => r.entityType))].sort();
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))];
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      })
    : [];
  res.json({ actions, entityTypes, actors });
});

// GET /audit-logs/export.csv — same filters as the list endpoint.
// Capped at 5000 rows so a careless "export everything" doesn't OOM the
// container; anything larger should be done through DB tooling anyway.
router.get('/export.csv', async (req, res) => {
  const where = buildWhere(req);
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  const hydrated = await hydrateActors(rows);

  const escape = (v) => {
    if (v == null) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    // Wrap in quotes if the cell contains CSV-meaningful characters.
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ['timestamp', 'actor', 'action', 'entity_type', 'entity_id', 'summary', 'metadata'];
  const lines = [header.join(',')];
  for (const r of hydrated) {
    lines.push(
      [
        r.createdAt.toISOString(),
        r.actor ? `${r.actor.firstName} ${r.actor.lastName}` : 'System',
        r.action,
        r.entityType,
        r.entityId || '',
        r.summary,
        r.metadata,
      ]
        .map(escape)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.csv"`);
  res.send(lines.join('\n'));
});

module.exports = router;
