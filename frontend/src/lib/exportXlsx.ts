import type { Shift, User, Position, Location } from '@/types';
import { api } from '@/lib/api';

// Dynamically load SheetJS only when needed (keeps the main bundle small)
async function loadXLSX() {
  const XLSX = await import('xlsx');
  return XLSX;
}

interface ExportOptions {
  weekStart: Date;
  token: string;
  members: User[];
  positions: Position[];
  locations: Location[];
  filterUser: string;
  filterPosition: string;
  filterLocation: string;
}

function formatTime12(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return m === 0 ? `${h} ${ampm}` : `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function exportScheduleXlsx(opts: ExportOptions) {
  const { weekStart, token, members, filterUser, filterPosition, filterLocation } = opts;

  // Fetch 3 weeks of shifts
  const start = weekStart.toISOString();
  const end = addDays(weekStart, 21).toISOString();
  const allShifts = await api<Shift[]>(`/shifts?start=${start}&end=${end}`, { token });

  // Apply the same filters as the calendar view
  const filtered = allShifts.filter((s) => {
    if (filterUser && s.user?.id !== filterUser) return false;
    if (filterPosition && s.position?.id !== filterPosition) return false;
    if (filterLocation && s.location?.id !== filterLocation) return false;
    return true;
  });

  // Build the list of visible employees (same logic as WeekCalendar)
  const unassigned = { id: '__unassigned__', firstName: 'Unassigned', lastName: '', positions: [], locations: [] } as any;
  const allRows = [...members, unassigned];
  const visibleRows = allRows.filter((r: any) => {
    if (r.id === '__unassigned__') return true;
    if (filterUser && r.id !== filterUser) return false;
    if (filterPosition) {
      const has = (r.positions ?? []).some((p: any) => p.id === filterPosition);
      if (!has) return false;
    }
    if (filterLocation) {
      const has = (r.locations ?? []).some((l: any) => l.id === filterLocation);
      if (!has) return false;
    }
    return true;
  });

  // Build 21 day columns
  const days: Date[] = [];
  for (let i = 0; i < 21; i++) {
    days.push(addDays(weekStart, i));
  }

  // Build header rows
  // Row 1: "Employee" + week labels spanning 7 cols each
  // Row 2: "Employee" + day names with dates
  const XLSX = await loadXLSX();

  // Build data as array of arrays
  const data: any[][] = [];

  // Week label row
  const weekLabelRow: any[] = [''];
  for (let w = 0; w < 3; w++) {
    const wStart = addDays(weekStart, w * 7);
    const wEnd = addDays(weekStart, w * 7 + 6);
    const label = `${wStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${wEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    weekLabelRow.push(label);
    for (let d = 1; d < 7; d++) weekLabelRow.push('');
  }
  data.push(weekLabelRow);

  // Day header row
  const dayHeaderRow: any[] = ['Employee'];
  for (const day of days) {
    dayHeaderRow.push(`${DAY_NAMES[day.getDay()]} ${day.getMonth() + 1}/${day.getDate()}`);
  }
  data.push(dayHeaderRow);

  // Employee rows
  for (const row of visibleRows) {
    const name = row.id === '__unassigned__' ? 'Unassigned' : `${row.firstName} ${row.lastName}`;
    const cells: any[] = [name];
    for (const day of days) {
      const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const dayShifts = filtered.filter((s) => {
        const sid = s.user?.id || '__unassigned__';
        const sDate = new Date(s.startTime);
        const sKey = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, '0')}-${String(sDate.getDate()).padStart(2, '0')}`;
        return sid === row.id && sKey === dayKey;
      });

      if (dayShifts.length === 0) {
        cells.push('');
      } else {
        // Multiple shifts in one cell: separate with newline
        const text = dayShifts
          .map((s) => {
            const st = new Date(s.startTime);
            const et = new Date(s.endTime);
            let label = `${formatTime12(st)}–${formatTime12(et)}`;
            if (s.position?.name) label += `\n${s.position.name}`;
            return label;
          })
          .join('\n\n');
        cells.push(text);
      }
    }
    data.push(cells);
  }

  // Build filter description for the header
  const filterParts: string[] = [];
  if (filterUser) {
    const m = members.find((u) => u.id === filterUser);
    if (m) filterParts.push(`${m.firstName} ${m.lastName}`);
  }
  if (filterPosition) {
    const p = opts.positions.find((x) => x.id === filterPosition);
    if (p) filterParts.push(p.name);
  }
  if (filterLocation) {
    const l = opts.locations.find((x) => x.id === filterLocation);
    if (l) filterParts.push(l.name);
  }
  const filterLabel = filterParts.length > 0 ? filterParts.join(' · ') : 'All employees';

  // Title row at the very top
  const titleRow = [`Pelican Schedule — ${filterLabel}`];
  for (let i = 1; i <= 21; i++) titleRow.push('');
  data.unshift(titleRow);

  // Create workbook
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths: name col wider, day cols uniform
  ws['!cols'] = [
    { wch: 20 }, // Employee name
    ...Array(21).fill({ wch: 16 }), // Day columns
  ];

  // Row heights: make data rows taller to fit shift info
  ws['!rows'] = [
    { hpt: 24 },  // Title
    { hpt: 20 },  // Week labels
    { hpt: 20 },  // Day headers
    ...Array(visibleRows.length).fill({ hpt: 50 }), // Data rows
  ];

  // Merge cells for week label row (row index 1 in the sheet = row 2 in data)
  ws['!merges'] = [
    // Title row spans all columns
    { s: { r: 0, c: 0 }, e: { r: 0, c: 21 } },
    // Week 1 label
    { s: { r: 1, c: 1 }, e: { r: 1, c: 7 } },
    // Week 2 label
    { s: { r: 1, c: 8 }, e: { r: 1, c: 14 } },
    // Week 3 label
    { s: { r: 1, c: 15 }, e: { r: 1, c: 21 } },
  ];

  // Set print area and page setup for landscape, fit to one page wide
  ws['!printHeader'] = [0, 2]; // Repeat top 3 rows on each page

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Schedule');

  // Write and download
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const dateLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).replace(/[, ]/g, '-');
  link.download = `pelican-schedule-${dateLabel}-3wk.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
