const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { loadScope, userScopeWhere, shiftScopeWhere } = require('../lib/managerScope');

const router = Router();

router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));

// GET /approvals
// Unified manager queue — everything that needs a decision, in one payload,
// so the mobile inbox doesn't have to fan out three requests on a spotty
// connection. Returns shape:
//   { timeoff: [...], swaps: [...], counts: { timeoff, swaps, total } }
//
// Scope comes from lib/managerScope.loadScope so this endpoint stays in lock-
// step with live-roster, dashboard, and attendance — there's one definition
// of "what does this manager see", not three.
router.get('/', async (req, res) => {
  const orgId = req.user.organizationId;
  const scope = await loadScope(req.user.id, req.user.role);

  // Employees in scope. For 'all' we skip the narrowing filter; for 'none'
  // (shouldn't happen here because requireRole gates it) we return nothing.
  const userWhere = userScopeWhere(scope);
  const scopedUsers = await prisma.user.findMany({
    where: { organizationId: orgId, ...(userWhere || {}) },
    select: { id: true },
  });
  const employeeFilter = { in: scopedUsers.map((u) => u.id) };

  const timeoff = await prisma.timeOffRequest.findMany({
    where: { userId: employeeFilter, status: 'PENDING' },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Swap queue: ACCEPTED means a coworker said yes and it's blocking on the
  // manager. Scope the underlying shift so dept managers never see swaps
  // for shifts outside their department.
  const shiftWhere = shiftScopeWhere(scope);
  const swaps = await prisma.shiftSwap.findMany({
    where: {
      status: 'ACCEPTED',
      shift: { organizationId: orgId, ...(shiftWhere || {}) },
    },
    include: {
      shift: {
        include: {
          position: { select: { id: true, name: true, color: true } },
          location: { select: { id: true, name: true } },
        },
      },
      requester: { select: { id: true, firstName: true, lastName: true } },
      target: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    timeoff,
    swaps,
    counts: {
      timeoff: timeoff.length,
      swaps: swaps.length,
      total: timeoff.length + swaps.length,
    },
  });
});

module.exports = router;
