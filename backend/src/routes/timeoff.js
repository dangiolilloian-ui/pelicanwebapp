const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { audit } = require('../lib/audit');
const { recordConsumeForTimeoff, getBalance, getConfig } = require('../lib/pto');
const { notify, notifyMany } = require('../lib/notify');

const router = Router();

// List time-off requests for the org
router.get('/', authenticate, async (req, res) => {
  const where = {};

  if (req.user.role === 'EMPLOYEE') {
    where.userId = req.user.id;
  } else {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId },
      select: { id: true },
    });
    where.userId = { in: users.map((u) => u.id) };
  }

  if (req.query.status) {
    where.status = req.query.status;
  }

  const requests = await prisma.timeOffRequest.findMany({
    where,
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(requests);
});

// Create request
router.post('/', authenticate, async (req, res) => {
  const { startDate, endDate, reason, hours } = req.body;
  const request = await prisma.timeOffRequest.create({
    data: {
      userId: req.user.id,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      hours: hours != null && hours !== '' ? Number(hours) : null,
      reason,
    },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  // Notify managers/owners
  const managers = await prisma.user.findMany({
    where: {
      organizationId: req.user.organizationId,
      role: { in: ['OWNER', 'MANAGER'] },
      id: { not: req.user.id },
    },
    select: { id: true },
  });
  await notifyMany(managers.map((m) => m.id), {
    type: 'TIMEOFF_REQUESTED',
    title: 'New time-off request',
    body: `${request.user.firstName} ${request.user.lastName} requested time off`,
    link: '/dashboard/timeoff',
  });

  res.status(201).json(request);
});

// Approve/Deny
router.put('/:id', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { status } = req.body;
  const request = await prisma.timeOffRequest.update({
    where: { id: req.params.id },
    data: { status },
    include: { user: { select: { id: true, firstName: true, lastName: true } } },
  });

  if (status === 'APPROVED' && request.hours && request.hours > 0) {
    // Enforce non-negative balance unless org policy opts in. We warn in the
    // response so the manager sees the reason; they can still override by
    // manually adjusting afterwards.
    const config = await getConfig(req.user.organizationId);
    const balance = await getBalance(request.userId);
    if (!config.allowNegative && balance < request.hours) {
      // Roll back the status update so the approval doesn't go through.
      await prisma.timeOffRequest.update({ where: { id: request.id }, data: { status: 'PENDING' } });
      return res.status(400).json({
        error: `Insufficient PTO balance: ${balance.toFixed(2)}h available, ${request.hours}h requested`,
      });
    }
    await recordConsumeForTimeoff(req.user.organizationId, request, req.user.id);
  }

  if (status === 'APPROVED' || status === 'DENIED') {
    const toOrg = await prisma.organization.findUnique({ where: { id: req.user.organizationId }, select: { timezone: true } });
    const toTz = toOrg?.timezone || 'America/New_York';
    await notify(request.userId, {
      type: status === 'APPROVED' ? 'TIMEOFF_APPROVED' : 'TIMEOFF_DENIED',
      title: `Time-off ${status.toLowerCase()}`,
      body: `Your request for ${new Date(request.startDate).toLocaleDateString('en-US', { timeZone: toTz })} – ${new Date(request.endDate).toLocaleDateString('en-US', { timeZone: toTz })} was ${status.toLowerCase()}.`,
      link: '/dashboard/timeoff',
    });
  }

  await audit(req, `TIMEOFF_${status}`, 'TIMEOFF', request.id,
    `${status === 'APPROVED' ? 'Approved' : status === 'DENIED' ? 'Denied' : 'Updated'} time-off for ${request.user.firstName} ${request.user.lastName}`,
    { startDate: request.startDate, endDate: request.endDate });

  res.json(request);
});

// Delete request
router.delete('/:id', authenticate, async (req, res) => {
  await prisma.timeOffRequest.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

module.exports = router;
