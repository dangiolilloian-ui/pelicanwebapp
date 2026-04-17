const { Router } = require('express');
const prisma = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { computePoints } = require('../lib/attendancePoints');
const { checkMinorShifts } = require('../lib/minorRules');

const router = Router();

// Labor report for a date range
router.get('/labor', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const shifts = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      startTime: { gte: new Date(start), lte: new Date(end) },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      position: { select: { id: true, name: true, color: true, hourlyRate: true } },
      location: { select: { id: true, name: true, weeklyBudget: true } },
    },
  });

  // Range length in weeks, so a budget declared per-week can be compared to
  // an arbitrary range. We use ceil so partial weeks count as a full budget
  // cycle — better to under-report % used than pretend half a week is fine.
  const rangeMs = new Date(end).getTime() - new Date(start).getTime();
  const rangeWeeks = Math.max(1, Math.ceil(rangeMs / (7 * 24 * 3600 * 1000)));

  let totalHours = 0;
  let totalCost = 0;
  const byLocation = new Map();
  const byPosition = new Map();
  const byEmployee = new Map();
  const byDay = new Map();

  for (const s of shifts) {
    const hours = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 3600000;
    const rate = s.position?.hourlyRate ?? 0;
    const cost = hours * rate;
    totalHours += hours;
    totalCost += cost;

    // Location
    const locKey = s.location?.id || '__none__';
    const locName = s.location?.name || 'No location';
    const loc = byLocation.get(locKey) || {
      id: locKey,
      name: locName,
      hours: 0,
      cost: 0,
      shifts: 0,
      // budget for the full range (per-week budget × #weeks in range)
      budget: s.location?.weeklyBudget != null ? s.location.weeklyBudget * rangeWeeks : null,
    };
    loc.hours += hours;
    loc.cost += cost;
    loc.shifts += 1;
    byLocation.set(locKey, loc);

    // Position
    const posKey = s.position?.id || '__none__';
    const posName = s.position?.name || 'No position';
    const pos = byPosition.get(posKey) || {
      id: posKey,
      name: posName,
      color: s.position?.color || '#9ca3af',
      rate,
      hours: 0,
      cost: 0,
      shifts: 0,
    };
    pos.hours += hours;
    pos.cost += cost;
    pos.shifts += 1;
    byPosition.set(posKey, pos);

    // Employee
    if (s.user) {
      const emp = byEmployee.get(s.user.id) || {
        id: s.user.id,
        name: `${s.user.firstName} ${s.user.lastName}`,
        hours: 0,
        cost: 0,
        shifts: 0,
      };
      emp.hours += hours;
      emp.cost += cost;
      emp.shifts += 1;
      byEmployee.set(s.user.id, emp);
    }

    // Day
    const dayKey = new Date(s.startTime).toISOString().slice(0, 10);
    const day = byDay.get(dayKey) || { date: dayKey, hours: 0, cost: 0, shifts: 0 };
    day.hours += hours;
    day.cost += cost;
    day.shifts += 1;
    byDay.set(dayKey, day);
  }

  // Pull any sales rows that overlap the range so we can compute labor %
  // per location and overall. Labor % = labor cost / sales, expressed 0..1.
  // If a location has no sales entered, we leave its laborPct null rather
  // than render an infinity — callers should treat null as "not enough data".
  const salesRows = await prisma.dailySales.findMany({
    where: {
      organizationId: req.user.organizationId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
  });
  const salesByLoc = new Map();
  let totalSales = 0;
  for (const row of salesRows) {
    salesByLoc.set(row.locationId, (salesByLoc.get(row.locationId) || 0) + row.amount);
    totalSales += row.amount;
  }

  const round = (v) => Math.round(v * 100) / 100;
  const finalize = (arr) =>
    arr.map((o) => ({ ...o, hours: round(o.hours), cost: round(o.cost) }));

  const byLocationWithSales = [...byLocation.values()].map((l) => {
    const sales = l.id === '__none__' ? 0 : salesByLoc.get(l.id) || 0;
    return {
      ...l,
      sales: round(sales),
      laborPct: sales > 0 ? round((l.cost / sales) * 100) / 100 : null,
    };
  });

  res.json({
    range: { start, end },
    totalShifts: shifts.length,
    totalHours: round(totalHours),
    totalCost: round(totalCost),
    totalSales: round(totalSales),
    laborPct: totalSales > 0 ? round((totalCost / totalSales) * 100) / 100 : null,
    byLocation: finalize(byLocationWithSales.sort((a, b) => b.cost - a.cost)),
    byPosition: finalize([...byPosition.values()].sort((a, b) => b.cost - a.cost)),
    byEmployee: finalize([...byEmployee.values()].sort((a, b) => b.hours - a.hours).slice(0, 20)),
    byDay: finalize([...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))),
  });
});

// Attendance report: for each PUBLISHED shift in the range that has already
// ended, classify it as on-time / late / no-show based on the TimeEntry that
// linked to it at clock-in. Lateness threshold is 5 minutes after startTime.
router.get('/attendance', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const LATE_THRESHOLD_MS = 5 * 60 * 1000;
  const now = new Date();
  const rangeEnd = new Date(end);
  const cutoff = rangeEnd < now ? rangeEnd : now; // ignore shifts that haven't ended yet

  const shifts = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      status: 'PUBLISHED',
      userId: { not: null },
      startTime: { gte: new Date(start), lte: rangeEnd },
      endTime: { lte: cutoff },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  const shiftIds = shifts.map((s) => s.id);
  const entries = shiftIds.length
    ? await prisma.timeEntry.findMany({ where: { shiftId: { in: shiftIds } } })
    : [];
  const entryByShift = new Map(entries.map((e) => [e.shiftId, e]));

  // Per-employee counters
  const byEmp = new Map();
  const bump = (user, field, detail) => {
    const key = user.id;
    const row = byEmp.get(key) || {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`,
      total: 0,
      onTime: 0,
      late: 0,
      noShow: 0,
      totalLateMinutes: 0,
      incidents: [],
    };
    row.total += 1;
    row[field] += 1;
    if (detail) {
      if (detail.lateMinutes) row.totalLateMinutes += detail.lateMinutes;
      if (row.incidents.length < 20) row.incidents.push(detail);
    }
    byEmp.set(key, row);
  };

  let totalShifts = 0;
  let onTime = 0;
  let late = 0;
  let noShow = 0;

  for (const s of shifts) {
    totalShifts += 1;
    const entry = entryByShift.get(s.id);
    if (!entry) {
      noShow += 1;
      bump(s.user, 'noShow', {
        kind: 'no-show',
        shiftId: s.id,
        startTime: s.startTime,
      });
      continue;
    }
    const lateMs = new Date(entry.clockIn).getTime() - new Date(s.startTime).getTime();
    if (lateMs > LATE_THRESHOLD_MS) {
      late += 1;
      bump(s.user, 'late', {
        kind: 'late',
        shiftId: s.id,
        startTime: s.startTime,
        clockIn: entry.clockIn,
        lateMinutes: Math.round(lateMs / 60000),
      });
    } else {
      onTime += 1;
      bump(s.user, 'onTime', null);
    }
  }

  const byEmployee = [...byEmp.values()]
    .sort((a, b) => b.noShow * 10 + b.late - (a.noShow * 10 + a.late))
    .map((r) => ({ ...r, incidents: r.incidents }));

  res.json({
    range: { start, end },
    totalShifts,
    onTime,
    late,
    noShow,
    byEmployee,
  });
});

// Payroll CSV: aggregate TimeEntry rows by user × ISO-week, split regular / OT
// at 40h, derive a weighted hourly rate from the worked shifts' positions, and
// return a plain text/csv stream the gestoría can feed into ADP/Gusto/Paychex.
router.get('/payroll', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const startDate = new Date(start);
  const endDate = new Date(end);

  const entries = await prisma.timeEntry.findMany({
    where: {
      clockIn: { gte: startDate, lte: endDate },
      clockOut: { not: null },
      user: { organizationId: req.user.organizationId },
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      // shift pulled separately below (shiftId is nullable and Prisma doesn't
      // expose a relation on TimeEntry in our current schema)
    },
    orderBy: { clockIn: 'asc' },
  });

  // Preload holidays that fall inside the payroll range so we can stamp any
  // hours worked on those days with the configured multiplier. Keyed by the
  // date's ISO "YYYY-MM-DD" slice for a cheap lookup per entry.
  const holidayRows = await prisma.holiday.findMany({
    where: {
      organizationId: req.user.organizationId,
      date: { gte: startDate, lte: endDate },
    },
  });
  const holidayByDate = new Map(
    holidayRows.map((h) => [h.date.toISOString().slice(0, 10), h])
  );

  // Batch-fetch the shifts we need for rate lookup
  const shiftIds = [...new Set(entries.map((e) => e.shiftId).filter(Boolean))];
  const shifts = shiftIds.length
    ? await prisma.shift.findMany({
        where: { id: { in: shiftIds } },
        include: { position: { select: { hourlyRate: true } } },
      })
    : [];
  const shiftRate = new Map(shifts.map((s) => [s.id, s.position?.hourlyRate ?? 0]));

  // Monday-start ISO week key: "YYYY-MM-DD" of that Monday
  const weekKey = (d) => {
    const x = new Date(d);
    const day = x.getUTCDay(); // 0..6 with 0 = Sunday
    const diff = day === 0 ? -6 : 1 - day;
    x.setUTCDate(x.getUTCDate() + diff);
    x.setUTCHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };

  // { `${userId}|${week}`: { user, week, hours, weightedCost, holidayHours, holidayPremium } }
  //
  // Holiday handling: if the clock-in falls on a configured holiday, we
  // count the hours into a separate `holidayHours` bucket and accumulate a
  // `holidayPremium` (extra pay above the normal rate) using
  // `rate * hours * (multiplier - 1)`. The base pay still flows through the
  // regular/OT split below — the premium is added on top in the final row.
  const buckets = new Map();
  for (const e of entries) {
    const durationMs =
      new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime() - e.totalBreakMinutes * 60000;
    if (durationMs <= 0) continue;
    const hours = durationMs / 3600000;
    const rate = e.shiftId ? shiftRate.get(e.shiftId) ?? 0 : 0;

    const dateKey = new Date(e.clockIn).toISOString().slice(0, 10);
    const holiday = holidayByDate.get(dateKey);

    const wk = weekKey(e.clockIn);
    const key = `${e.userId}|${wk}`;
    const bucket = buckets.get(key) || {
      userId: e.userId,
      userName: `${e.user.firstName} ${e.user.lastName}`,
      week: wk,
      hours: 0,
      weightedCost: 0,
      ratedHours: 0,
      holidayHours: 0,
      holidayPremium: 0,
    };
    bucket.hours += hours;
    if (rate > 0) {
      bucket.weightedCost += hours * rate;
      bucket.ratedHours += hours;
    }
    if (holiday) {
      bucket.holidayHours += hours;
      if (rate > 0 && holiday.multiplier > 1) {
        bucket.holidayPremium += hours * rate * (holiday.multiplier - 1);
      }
    }
    buckets.set(key, bucket);
  }

  const round2 = (v) => Math.round(v * 100) / 100;
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    'Employee ID',
    'Employee Name',
    'Week Starting',
    'Regular Hours',
    'OT Hours',
    'Total Hours',
    'Holiday Hours',
    'Holiday Premium',
    'Avg Hourly Rate',
    'Est Gross Pay',
  ];

  const rows = [...buckets.values()]
    .sort((a, b) => (a.userName.localeCompare(b.userName) || a.week.localeCompare(b.week)))
    .map((b) => {
      const total = b.hours;
      const regular = Math.min(total, 40);
      const ot = Math.max(0, total - 40);
      const avgRate = b.ratedHours > 0 ? b.weightedCost / b.ratedHours : 0;
      // Classic 1.5x overtime; falls back to 0 when we don't have a rate.
      // Holiday premium is paid *on top* of the base + OT split — the
      // underlying hours are already counted in regular/OT above.
      const base = avgRate > 0 ? regular * avgRate + ot * avgRate * 1.5 : 0;
      const estGross = base + b.holidayPremium;
      return [
        b.userId,
        b.userName,
        b.week,
        round2(regular).toFixed(2),
        round2(ot).toFixed(2),
        round2(total).toFixed(2),
        round2(b.holidayHours).toFixed(2),
        b.holidayPremium > 0 ? round2(b.holidayPremium).toFixed(2) : '',
        avgRate > 0 ? round2(avgRate).toFixed(2) : '',
        estGross > 0 ? round2(estGross).toFixed(2) : '',
      ];
    });

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';
  const filename = `pelican-payroll-${start.slice(0, 10)}-to-${end.slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

router.get('/attendance-points', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const result = await computePoints(req.user.organizationId);
  res.json(result);
});

// Employee self-service: see your own attendance points without needing
// manager role. Returns the same shape as the full report but filtered to
// just the requesting user.
router.get('/my-attendance', authenticate, async (req, res) => {
  const result = await computePoints(req.user.organizationId);
  const me = result.byEmployee.find((e) => e.id === req.user.id) || {
    id: req.user.id,
    name: '',
    points: 0,
    noShow: 0,
    late: 0,
    earlyOut: 0,
    incidents: [],
    status: 'clear',
  };
  res.json({ config: result.config, windowStart: result.windowStart, ...me });
});

// Minor labor compliance report: for every user in the org who has a birth
// date and is under 18, return any shifts in the range that violate the
// under-18 rule set in lib/minorRules.js.  Adults and users without a DOB
// are silently skipped — nothing to check.
router.get('/minor-compliance', authenticate, requireRole('OWNER', 'ADMIN', 'MANAGER'), async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const users = await prisma.user.findMany({
    where: {
      organizationId: req.user.organizationId,
      birthDate: { not: null },
    },
    select: { id: true, firstName: true, lastName: true, birthDate: true },
  });

  // Bail out early if nobody has a DOB on file — avoids a wasted shift scan.
  if (users.length === 0) return res.json({ users: [], totalViolations: 0 });

  const userIds = users.map((u) => u.id);
  const shifts = await prisma.shift.findMany({
    where: {
      organizationId: req.user.organizationId,
      userId: { in: userIds },
      startTime: { gte: new Date(start), lte: new Date(end) },
    },
    select: { id: true, userId: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });

  const shiftsByUser = new Map();
  for (const s of shifts) {
    if (!shiftsByUser.has(s.userId)) shiftsByUser.set(s.userId, []);
    shiftsByUser.get(s.userId).push(s);
  }

  const result = [];
  let total = 0;
  for (const u of users) {
    const userShifts = shiftsByUser.get(u.id) ?? [];
    const violations = checkMinorShifts(u, userShifts);
    if (violations.length === 0) continue;
    total += violations.length;
    result.push({
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      birthDate: u.birthDate,
      violations,
    });
  }

  res.json({ users: result, totalViolations: total });
});

module.exports = router;
