const { Router } = require('express');
const prisma = require('../config/db');
const { buildCalendar } = require('../lib/ical');

const router = Router();

// Public iCal feed — auth'd via opaque token in URL only
router.get('/:token.ics', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { icalToken: req.params.token },
      include: { organization: { select: { name: true } } },
    });
    if (!user) return res.status(404).send('Calendar not found');

    // Shifts from 30 days ago to 90 days forward
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const to = new Date();
    to.setDate(to.getDate() + 90);

    const shifts = await prisma.shift.findMany({
      where: {
        userId: user.id,
        status: 'PUBLISHED',
        startTime: { gte: from, lte: to },
      },
      include: {
        position: { select: { name: true, color: true } },
        location: { select: { name: true, address: true } },
      },
      orderBy: { startTime: 'asc' },
    });

    const body = buildCalendar({
      user,
      shifts,
      orgName: user.organization.name,
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(body);
  } catch (err) {
    console.error('ical feed error', err);
    res.status(500).send('Error generating calendar');
  }
});

module.exports = router;
