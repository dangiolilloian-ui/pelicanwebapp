const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = Router();

router.use(authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'));

// GET /approvals
// Unified manager queue — everything that needs a decision, in one payload,
// so the mobile inbox doesn't have to fan out three requests on a spotty
// connection. Returns shape:
//   { timeoff: [...], swaps: [...], counts: { timeoff, swaps, total } }
router.get('/', async (req, res) => {
  const orgId = req.user.organizationId;

  // PTO/time-off — only PENDING belongs in the inbox. Approved/denied stay
  // on the full timeoff page.
  const users = await prisma.user.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  const timeoff = await prisma.timeOffRequest.findMany({
    where: { userId: { in: userIds }, status: 'PENDING' },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' }, // oldest-first so nothing rots at the bottom
  });

  // Swaps — ACCEPTED means a coworker said yes and it's blocking on manager.
  // That's what matters for the inbox. (PENDING swaps belong to the
  // employees' own marketplace.)
  const swaps = await prisma.shiftSwap.findMany({
    where: {
      status: 'ACCEPTED',
      shift: { organizationId: orgId },
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
