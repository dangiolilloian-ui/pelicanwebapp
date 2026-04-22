const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));

// Helper: get the position & location IDs this manager oversees.
// Owners see everything. Managers with no dept assignments also see
// everything (backward compat). Returns null when "show all".
async function getManagedScope(userId, role) {
  if (role === 'OWNER') return null; // owners see everything

  const mgr = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      managedPositions: { select: { id: true } },
      managedLocations: { select: { id: true } },
    },
  });
  const posIds = mgr?.managedPositions.map((p) => p.id) || [];
  const locIds = mgr?.managedLocations.map((l) => l.id) || [];

  // If no dept assignments, they see everything (fallback)
  if (posIds.length === 0 && locIds.length === 0) return null;

  return { posIds, locIds };
}

// GET /approvals
// Unified manager queue — everything that needs a decision, in one payload,
// so the mobile inbox doesn't have to fan out three requests on a spotty
// connection. Returns shape:
//   { timeoff: [...], swaps: [...], counts: { timeoff, swaps, total } }
router.get('/', async (req, res) => {
  const orgId = req.user.organizationId;
  const scope = await getManagedScope(req.user.id, req.user.role);

  // PTO/time-off — only PENDING belongs in the inbox.
  // Scope: if this manager has dept assignments, only show requests from
  // employees in their managed positions/locations.
  let employeeFilter;
  if (scope) {
    const or = [];
    if (scope.posIds.length > 0) or.push({ positions: { some: { id: { in: scope.posIds } } } });
    if (scope.locIds.length > 0) or.push({ locations: { some: { id: { in: scope.locIds } } } });
    const scopedUsers = await prisma.user.findMany({
      where: { organizationId: orgId, OR: or },
      select: { id: true },
    });
    employeeFilter = { in: scopedUsers.map((u) => u.id) };
  } else {
    const allUsers = await prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    employeeFilter = { in: allUsers.map((u) => u.id) };
  }

  const timeoff = await prisma.timeOffRequest.findMany({
    where: { userId: employeeFilter, status: 'PENDING' },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // Swaps — ACCEPTED means a coworker said yes and it's blocking on manager.
  // Scope by shift position/location if dept assignments exist.
  const swapWhere = {
    status: 'ACCEPTED',
    shift: { organizationId: orgId },
  };
  if (scope) {
    const or = [];
    if (scope.posIds.length > 0) or.push({ positionId: { in: scope.posIds } });
    if (scope.locIds.length > 0) or.push({ locationId: { in: scope.locIds } });
    swapWhere.shift = { organizationId: orgId, OR: or };
  }

  const swaps = await prisma.shiftSwap.findMany({
    where: swapWhere,
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
