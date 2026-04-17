const prisma = require('../config/db');

/**
 * Check if a given date falls on a holiday for the organization.
 * Returns the holiday object if found, or null.
 */
async function getHolidayOnDate(organizationId, date) {
  const d = new Date(date);
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  return prisma.holiday.findFirst({
    where: {
      organizationId,
      date: { gte: dayStart, lt: dayEnd },
    },
  });
}

/**
 * Get all holidays in a date range for the organization.
 * Returns an array of holiday objects.
 */
async function getHolidaysInRange(organizationId, start, end) {
  return prisma.holiday.findMany({
    where: {
      organizationId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
  });
}

/**
 * Returns a Set of "YYYY-MM-DD" strings for holidays in the range.
 */
async function getHolidayDateSet(organizationId, start, end) {
  const holidays = await getHolidaysInRange(organizationId, start, end);
  const set = new Set();
  for (const h of holidays) {
    const d = new Date(h.date);
    set.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return set;
}

module.exports = { getHolidayOnDate, getHolidaysInRange, getHolidayDateSet };
