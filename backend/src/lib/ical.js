// Minimal iCalendar (RFC 5545) generator for a user's shift list
function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function escapeText(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldLine(line) {
  // Fold long lines at 75 octets per RFC 5545
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
}

function buildCalendar({ user, shifts, orgName }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pelican//Shift Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${orgName} — ${user.firstName} ${user.lastName}`)}`,
    `X-WR-TIMEZONE:America/New_York`,
  ];

  const now = new Date();
  for (const s of shifts) {
    const start = new Date(s.startTime);
    const end = new Date(s.endTime);
    const summaryBits = [];
    if (s.position?.name) summaryBits.push(s.position.name);
    if (s.location?.name) summaryBits.push(`@ ${s.location.name}`);
    const summary = summaryBits.length ? summaryBits.join(' ') : 'Shift';

    const descBits = [];
    if (s.position?.name) descBits.push(`Position: ${s.position.name}`);
    if (s.location?.name) descBits.push(`Location: ${s.location.name}`);
    if (s.location?.address) descBits.push(s.location.address);
    if (s.notes) descBits.push(s.notes);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:shift-${s.id}@pelican`);
    lines.push(`DTSTAMP:${formatDate(now)}`);
    lines.push(`DTSTART:${formatDate(start)}`);
    lines.push(`DTEND:${formatDate(end)}`);
    lines.push(`SUMMARY:${escapeText(summary)}`);
    if (descBits.length) lines.push(`DESCRIPTION:${escapeText(descBits.join('\n'))}`);
    if (s.location?.name) lines.push(`LOCATION:${escapeText(s.location.name)}`);
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

module.exports = { buildCalendar };
