const prisma = require('../config/db');

/**
 * Check if a proposed shift conflicts with the user's declared availability.
 * Returns an array of warning strings (empty if everything is fine).
 */
async function checkAvailability({ userId, startTime, endTime }) {
  if (!userId) return [];
  const warnings = [];
  const start = new Date(startTime);
  const end = new Date(endTime);
  const dayOfWeek = start.getDay(); // 0=Sun..6=Sat

  const entries = await prisma.availability.findMany({ where: { userId, dayOfWeek } });
  if (entries.length === 0) return []; // no declared availability → skip

  const notAvailable = entries.find((e) => !e.available);
  if (notAvailable) {
    warnings.push(`Employee marked ${dayNames[dayOfWeek]} as unavailable`);
    return warnings;
  }

  const shiftStartMin = start.getHours() * 60 + start.getMinutes();
  const shiftEndMin = end.getHours() * 60 + end.getMinutes();

  const covered = entries.some((e) => {
    const [sh, sm] = e.startTime.split(':').map(Number);
    const [eh, em] = e.endTime.split(':').map(Number);
    return sh * 60 + sm <= shiftStartMin && eh * 60 + em >= shiftEndMin;
  });

  if (!covered) {
    warnings.push(
      `Shift is outside declared availability for ${dayNames[dayOfWeek]}`
    );
  }
  return warnings;
}

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

module.exports = { checkAvailability };
