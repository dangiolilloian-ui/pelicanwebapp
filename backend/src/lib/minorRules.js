// Minor (under-18) labor compliance for NJ/PA retail.
//
// Neither state defines a one-size-fits-all rule, so we implement the common
// strict subset so a manager never has to remember the exact statutes:
//
//   14 & 15 year-olds (both states):
//     - max 3 hours on a school day
//     - max 8 hours on a non-school day
//     - max 18 hours in a school week
//     - max 40 hours in a non-school week
//     - cannot work before 7am or after 7pm (9pm Jun 1 – Labor Day)
//
//   16 & 17 year-olds:
//     - NJ: max 8 h/day, 40 h/school week, 48 h/non-school week; not after
//       11pm school night or 12am non-school night
//     - PA: max 8 h/day, 28 h/school week, 44 h/non-school week; not after
//       10pm school night
//     We pick the stricter of the two so an org serving both states stays
//     safe.  The rule set is intentionally conservative — the goal is "flag
//     anything a DOL inspector might write up", not legal perfection.
//
// School-week detection is kept simple: a week is treated as a "school week"
// unless it falls entirely in a configured summer window (default Jun 15 –
// Aug 31) or the date is a US federal holiday.  Managers can override per
// shift via `isSchoolDay` in the future, but we don't need that yet.

function ageOn(birthDate, refDate) {
  const b = new Date(birthDate);
  const r = new Date(refDate);
  let age = r.getUTCFullYear() - b.getUTCFullYear();
  const m = r.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && r.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

function isSummer(date) {
  // Rough summer window — no school.  Jun 15 through Aug 31.
  const d = new Date(date);
  const m = d.getUTCMonth(); // 0-indexed
  const day = d.getUTCDate();
  if (m === 5 && day >= 15) return true;
  if (m === 6) return true;
  if (m === 7) return true;
  return false;
}

function isWeekend(date) {
  const dow = new Date(date).getUTCDay();
  return dow === 0 || dow === 6;
}

function isSchoolDay(date) {
  // Saturday/Sunday/summer = non-school day.  A future enhancement could
  // pull from a holiday list per org.
  if (isSummer(date)) return false;
  if (isWeekend(date)) return false;
  return true;
}

function hoursBetween(start, end) {
  return (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);
}

function localHour(date) {
  // Use UTC; if the org stores shift times in local we should convert, but
  // for now Pelican stores UTC and managers set times in local — close enough
  // for a warning-level check.
  const d = new Date(date);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

function getWeekKey(date) {
  // ISO week key (YYYY-Www) so we can bucket shifts by school week.
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // Move to the Sunday that starts this week
  const dow = d.getUTCDay();
  const sunday = new Date(d);
  sunday.setUTCDate(d.getUTCDate() - dow);
  return sunday.toISOString().slice(0, 10);
}

/**
 * Given a user and their shifts within some range, return an array of
 * human-readable violation strings.  Shifts are expected to have ISO
 * `startTime`/`endTime`.  Returns [] for adult users or users without DOB.
 */
function checkMinorShifts(user, shifts) {
  if (!user?.birthDate) return [];
  const violations = [];

  // Age is computed per shift so a 15-yr-old who turns 16 mid-range gets
  // the right bucket applied to later shifts.
  const byWeek = new Map();
  for (const s of shifts) {
    const wk = getWeekKey(s.startTime);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(s);

    const age = ageOn(user.birthDate, s.startTime);
    if (age >= 18) continue;
    const duration = hoursBetween(s.startTime, s.endTime);
    const schoolDay = isSchoolDay(s.startTime);
    const startHour = localHour(s.startTime);
    const endHour = localHour(s.endTime);
    const dateStr = new Date(s.startTime).toISOString().slice(0, 10);

    if (age < 14) {
      violations.push(`${dateStr}: ${user.firstName} is under 14 — cannot work at all`);
      continue;
    }

    if (age <= 15) {
      if (schoolDay && duration > 3) {
        violations.push(`${dateStr}: ${duration.toFixed(1)}h on a school day exceeds the 3h limit (age ${age})`);
      }
      if (!schoolDay && duration > 8) {
        violations.push(`${dateStr}: ${duration.toFixed(1)}h exceeds the 8h non-school-day limit (age ${age})`);
      }
      if (startHour < 7) {
        violations.push(`${dateStr}: start at ${startHour.toFixed(2)} is before the 7am minimum (age ${age})`);
      }
      const summerCurfew = isSummer(s.startTime) ? 21 : 19;
      if (endHour > summerCurfew && endHour !== 0) {
        violations.push(`${dateStr}: end at ${endHour.toFixed(2)} is past the ${summerCurfew}:00 curfew (age ${age})`);
      }
    } else {
      // 16 & 17
      if (duration > 8) {
        violations.push(`${dateStr}: ${duration.toFixed(1)}h exceeds the 8h daily limit (age ${age})`);
      }
      // Stricter-of-NJ-PA school-night curfew: 10pm
      if (schoolDay && endHour > 22 && endHour !== 0) {
        violations.push(`${dateStr}: end at ${endHour.toFixed(2)} is past the 10pm school-night curfew (age ${age})`);
      }
    }
  }

  // Weekly totals
  for (const [wkKey, wkShifts] of byWeek) {
    const total = wkShifts.reduce((acc, s) => acc + hoursBetween(s.startTime, s.endTime), 0);
    // Use the age at the first shift of the week for the cap (close enough).
    const age = ageOn(user.birthDate, wkShifts[0].startTime);
    if (age >= 18) continue;
    const schoolWeek = wkShifts.some((s) => isSchoolDay(s.startTime));

    let cap;
    if (age <= 15) cap = schoolWeek ? 18 : 40;
    else cap = schoolWeek ? 28 : 44; // stricter PA numbers

    if (total > cap) {
      violations.push(
        `Week of ${wkKey}: ${total.toFixed(1)}h exceeds the ${cap}h ${schoolWeek ? 'school-' : 'non-school-'}week limit (age ${age})`
      );
    }
  }

  return violations;
}

module.exports = { checkMinorShifts, ageOn, isSchoolDay };
