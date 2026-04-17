const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notify, notifyMany } = require('../lib/notify');

const router = Router();

const includeAll = {
  shift: {
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true } },
      location: { select: { id: true, name: true } },
    },
  },
  requester: { select: { id: true, firstName: true, lastName: true } },
  target: { select: { id: true, firstName: true, lastName: true } },
};

// List swaps relevant to the current user
router.get('/', authenticate, async (req, res) => {
  const where =
    req.user.role === 'EMPLOYEE'
      ? {
          OR: [
            { requesterId: req.user.id },
            { targetUserId: req.user.id },
            { targetUserId: null, status: 'PENDING' }, // open offers
          ],
          shift: { organizationId: req.user.organizationId },
        }
      : { shift: { organizationId: req.user.organizationId } };

  const swaps = await prisma.shiftSwap.findMany({
    where,
    include: includeAll,
    orderBy: { createdAt: 'desc' },
  });
  res.json(swaps);
});

// Employee proposes a swap on one of their own shifts
router.post('/', authenticate, async (req, res) => {
  const { shiftId, targetUserId, message } = req.body;

  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.organizationId !== req.user.organizationId) {
    return res.status(404).json({ error: 'Shift not found' });
  }
  if (shift.userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only swap your own shifts' });
  }

  const swap = await prisma.shiftSwap.create({
    data: {
      shiftId,
      requesterId: req.user.id,
      targetUserId: targetUserId || null,
      message,
    },
    include: includeAll,
  });

  // Notify target (or all employees if open)
  if (targetUserId) {
    await notify(targetUserId, {
      type: 'SWAP_PROPOSED',
      title: 'Shift swap proposed',
      body: `${swap.requester.firstName} ${swap.requester.lastName} wants to swap a shift with you.`,
      link: '/dashboard/swaps',
    });
  } else {
    // Notify managers so they see open swap market
    const managers = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId, role: { in: ['OWNER', 'MANAGER'] } },
      select: { id: true },
    });
    await notifyMany(
      managers.map((m) => m.id),
      {
        type: 'SWAP_PROPOSED',
        title: 'Open shift swap',
        body: `${swap.requester.firstName} ${swap.requester.lastName} is offering a shift.`,
        link: '/dashboard/swaps',
      }
    );
  }

  res.status(201).json(swap);
});

// Target accepts a swap (still needs manager approval)
router.post('/:id/accept', authenticate, async (req, res) => {
  const swap = await prisma.shiftSwap.findUnique({ where: { id: req.params.id }, include: includeAll });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  if (swap.status !== 'PENDING') return res.status(400).json({ error: 'Swap not pending' });
  if (swap.targetUserId && swap.targetUserId !== req.user.id) {
    return res.status(403).json({ error: 'Not your swap to accept' });
  }

  const updated = await prisma.shiftSwap.update({
    where: { id: swap.id },
    data: { status: 'ACCEPTED', targetUserId: req.user.id },
    include: includeAll,
  });

  // Notify requester + managers
  await notify(swap.requesterId, {
    type: 'SWAP_ACCEPTED',
    title: 'Swap accepted',
    body: 'A coworker accepted your swap. Waiting for manager approval.',
    link: '/dashboard/swaps',
  });
  const managers = await prisma.user.findMany({
    where: { organizationId: req.user.organizationId, role: { in: ['OWNER', 'MANAGER'] } },
    select: { id: true },
  });
  await notifyMany(
    managers.map((m) => m.id),
    {
      type: 'SWAP_PENDING_APPROVAL',
      title: 'Swap pending approval',
      body: 'A shift swap needs your approval.',
      link: '/dashboard/swaps',
    }
  );

  res.json(updated);
});

// Manager approves or denies
router.post('/:id/approve', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const swap = await prisma.shiftSwap.findUnique({ where: { id: req.params.id }, include: includeAll });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  if (swap.status !== 'ACCEPTED') return res.status(400).json({ error: 'Must be accepted first' });

  // Reassign the shift to the target user
  await prisma.shift.update({
    where: { id: swap.shiftId },
    data: { userId: swap.targetUserId },
  });
  const updated = await prisma.shiftSwap.update({
    where: { id: swap.id },
    data: { status: 'APPROVED' },
    include: includeAll,
  });

  await notify(swap.requesterId, {
    type: 'SWAP_APPROVED',
    title: 'Swap approved',
    body: 'Your shift has been transferred.',
    link: '/dashboard/schedule',
  });
  if (swap.targetUserId) {
    await notify(swap.targetUserId, {
      type: 'SWAP_APPROVED',
      title: 'Swap approved',
      body: 'A shift has been added to your schedule.',
      link: '/dashboard/schedule',
    });
  }

  res.json(updated);
});

router.post('/:id/deny', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const swap = await prisma.shiftSwap.findUnique({ where: { id: req.params.id } });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  const updated = await prisma.shiftSwap.update({
    where: { id: swap.id },
    data: { status: 'DENIED' },
    include: includeAll,
  });
  await notify(swap.requesterId, {
    type: 'SWAP_DENIED',
    title: 'Swap denied',
    body: 'Your swap request was not approved.',
    link: '/dashboard/swaps',
  });
  res.json(updated);
});

// Requester cancels
router.post('/:id/cancel', authenticate, async (req, res) => {
  const swap = await prisma.shiftSwap.findUnique({ where: { id: req.params.id } });
  if (!swap) return res.status(404).json({ error: 'Not found' });
  if (swap.requesterId !== req.user.id) return res.status(403).json({ error: 'Not your swap' });
  if (swap.status !== 'PENDING' && swap.status !== 'ACCEPTED') {
    return res.status(400).json({ error: 'Cannot cancel' });
  }
  const updated = await prisma.shiftSwap.update({
    where: { id: swap.id },
    data: { status: 'CANCELLED' },
    include: includeAll,
  });
  res.json(updated);
});

module.exports = router;
