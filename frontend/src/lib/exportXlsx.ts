import type { Shift, User, Position, Location } from '@/types';
import { api } from '@/lib/api';

export interface ExportOptions {
  weekStart: Date;
  weeks: 1 | 2 | 3;
  format: 'excel' | 'pdf' | 'print';
  token: string;
  members: User[];
  positions: Position[];
  locations: Location[];
  filterUser: string;
  filterPosition: string;
  filterLocation: string;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Compact time: 10 AM → "10", 6 PM → "6", 10:30 AM → "10:30" */
function shortTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  h = h % 12 || 12;
  return m === 0 ? `${h}` : `${h}:${String(m).padStart(2, '0')}`;
}

/** "10-6" style compact range */
function compactRange(start: Date, end: Date): string {
  return `${shortTime(start)}-${shortTime(end)}`;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function buildWorkbook(opts: ExportOptions) {
  const { weekStart, weeks, token, members, filterUser, filterPosition, filterLocation } = opts;

  const totalDays = weeks * 7;

  // Fetch shifts
  const start = weekStart.toISOString();
  const end = addDays(weekStart, totalDays).toISOString();
  const allShifts = await api<Shift[]>(`/shifts?start=${start}&end=${end}`, { token });

  // Apply the same filters as the calendar view
  const filtered = allShifts.filter((s) => {
    if (filterUser && s.user?.id !== filterUser) return false;
    if (filterPosition && s.position?.id !== filterPosition) return false;
    if (filterLocation && s.location?.id !== filterLocation) return false;
    return true;
  });

  // Visible employees (same logic as WeekCalendar)
  const visibleRows = members.filter((r) => {
    if (filterUser && r.id !== filterUser) return false;
    if (filterPosition) {
      if (!(r.positions ?? []).some((p) => p.id === filterPosition)) return false;
    }
    if (filterLocation) {
      if (!(r.locations ?? []).some((l) => l.id === filterLocation)) return false;
    }
    return true;
  });

  // Day columns
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) days.push(addDays(weekStart, i));

  // Dynamically import ExcelJS (keeps main bundle small)
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Schedule');

  const LAST_COL = 1 + totalDays; // col 1 = names, then N day cols

  // ─── Column widths ───────────────────────────────────────
  ws.getColumn(1).width = 18.71; // Name column
  for (let c = 2; c <= LAST_COL; c++) ws.getColumn(c).width = 13;

  // ─── Style helpers ───────────────────────────────────────
  const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
  const medium = { style: 'medium' as const, color: { argb: 'FF000000' } };
  const headerFont14 = { name: 'Calibri', size: 14, bold: true };
  const headerFont14nb = { name: 'Calibri', size: 14, bold: false };
  const nameFont = { name: 'Calibri', size: 11, bold: true };
  const dataFont = { name: 'Calibri', size: 11, bold: false };
  const centerAlign: Partial<import('exceljs').Alignment> = { horizontal: 'center', vertical: 'middle' };
  const centerContAlign: Partial<import('exceljs').Alignment> = { horizontal: 'centerContinuous', vertical: 'middle' };

  // Helper: date range label
  const rangeStart = weekStart;
  const rangeEnd = addDays(weekStart, totalDays - 1);
  const fmtShort = (d: Date) =>
    `${d.toLocaleString('en-US', { month: 'long' }).toUpperCase()} ${d.getDate()}`;

  const TOTAL_ROWS = 4 + visibleRows.length; // header rows + employee rows

  // ─── ROW 1: Date start + WEEK labels ────────────────────
  const row1 = ws.getRow(1);
  row1.height = 18.75;
  const a1 = ws.getCell(1, 1);
  a1.value = fmtShort(rangeStart);
  a1.font = { ...headerFont14, color: { argb: 'FFFFFFFF' } };
  a1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  a1.alignment = centerAlign;
  a1.border = { top: medium, left: medium, right: thin };

  // WEEK labels — use centerContinuous across 7 cols each
  for (let w = 0; w < weeks; w++) {
    const col = 2 + w * 7;
    for (let c = col; c < col + 7; c++) {
      const cell = ws.getCell(1, c);
      cell.font = headerFont14nb;
      cell.alignment = centerContAlign;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      cell.border = {
        top: medium,
        bottom: thin,
        left: c === col && w > 0 ? thin : undefined,
        right: c === LAST_COL ? medium : undefined,
      };
      if (c === col) cell.value = weeks === 1 ? '' : `WEEK ${w + 1}`;
    }
  }

  // ─── ROW 2: "TO" + Day names ─────────────────────────────
  const row2 = ws.getRow(2);
  row2.height = 18.75;
  const a2 = ws.getCell(2, 1);
  a2.value = 'TO';
  a2.font = { ...headerFont14, color: { argb: 'FFFFFFFF' } };
  a2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  a2.alignment = centerAlign;
  a2.border = { left: medium, right: thin };

  for (let i = 0; i < totalDays; i++) {
    const col = i + 2;
    const cell = ws.getCell(2, col);
    cell.value = DAY_LABELS[days[i].getDay()];
    cell.font = headerFont14;
    cell.alignment = centerAlign;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.border = {
      bottom: thin,
      left: thin,
      right: col === LAST_COL ? medium : thin,
    };
  }

  // ─── ROW 3: End date + day-of-month numbers ──────────────
  const row3 = ws.getRow(3);
  row3.height = 18.75;
  const a3 = ws.getCell(3, 1);
  a3.value = fmtShort(rangeEnd);
  a3.font = { ...headerFont14, color: { argb: 'FFFFFFFF' } };
  a3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } };
  a3.alignment = centerAlign;
  a3.border = { bottom: thin, left: medium, right: thin };

  for (let i = 0; i < totalDays; i++) {
    const col = i + 2;
    const cell = ws.getCell(3, col);
    cell.value = days[i].getDate();
    cell.font = headerFont14;
    cell.alignment = centerAlign;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.border = {
      top: thin,
      bottom: thin,
      left: thin,
      right: col === LAST_COL ? medium : thin,
    };
  }

  // ─── ROW 4: "Store Hours" + hours per day ────────────────
  const row4 = ws.getRow(4);
  row4.height = 18.75;
  const a4 = ws.getCell(4, 1);
  a4.value = 'Store Hours';
  a4.font = nameFont;
  a4.alignment = centerAlign;
  a4.border = { bottom: thin, left: medium, right: thin };

  for (let i = 0; i < totalDays; i++) {
    const col = i + 2;
    const cell = ws.getCell(4, col);
    // Sunday = "10-5", all other days = "10-6"
    cell.value = days[i].getDay() === 0 ? '10-5' : '10-6';
    cell.font = headerFont14;
    cell.alignment = centerAlign;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
    cell.border = {
      top: thin,
      bottom: thin,
      left: thin,
      right: col === LAST_COL ? medium : thin,
    };
  }

  // ─── EMPLOYEE ROWS ───────────────────────────────────────
  for (let r = 0; r < visibleRows.length; r++) {
    const emp = visibleRows[r];
    const rowIdx = 5 + r;
    const row = ws.getRow(rowIdx);
    row.height = 21;

    // Name cell
    const nameCell = ws.getCell(rowIdx, 1);
    nameCell.value = `${emp.firstName} ${emp.lastName?.charAt(0) || ''}.`;
    nameCell.font = nameFont;
    nameCell.alignment = centerAlign;
    const isLast = r === visibleRows.length - 1;
    nameCell.border = {
      top: thin,
      bottom: isLast ? medium : thin,
      left: medium,
      right: thin,
    };

    // Shift cells
    for (let i = 0; i < totalDays; i++) {
      const col = i + 2;
      const day = days[i];
      const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;

      const dayShifts = filtered.filter((s) => {
        const sid = s.user?.id;
        const sDate = new Date(s.startTime);
        const sKey = `${sDate.getFullYear()}-${String(sDate.getMonth() + 1).padStart(2, '0')}-${String(sDate.getDate()).padStart(2, '0')}`;
        return sid === emp.id && sKey === dayKey;
      });

      const cell = ws.getCell(rowIdx, col);
      if (dayShifts.length > 0) {
        cell.value = dayShifts
          .map((s) => compactRange(new Date(s.startTime), new Date(s.endTime)))
          .join('\n');
        cell.alignment = { ...centerAlign, wrapText: true };
      } else {
        cell.alignment = centerAlign;
      }
      cell.font = dataFont;
      cell.border = {
        top: thin,
        bottom: isLast ? medium : thin,
        left: thin,
        right: col === LAST_COL ? medium : thin,
      };
    }
  }

  // ─── Print setup ─────────────────────────────────────────
  const colLetter = String.fromCharCode(64 + LAST_COL > 90 ? 65 : 64 + LAST_COL);
  // For columns > Z we need AA, AB, etc.
  const colRef = LAST_COL <= 26
    ? String.fromCharCode(64 + LAST_COL)
    : String.fromCharCode(64 + Math.floor((LAST_COL - 1) / 26)) + String.fromCharCode(65 + ((LAST_COL - 1) % 26));

  ws.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9, // A4
    printArea: `A1:${colRef}${TOTAL_ROWS}`,
  };

  return { wb, totalDays, weeks, weekStart, rangeEnd };
}

export async function exportSchedule(opts: ExportOptions) {
  const { format } = opts;
  const { wb, weeks, weekStart } = await buildWorkbook(opts);

  const dateLabel = weekStart
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    .replace(/[, ]/g, '-');
  const weekLabel = weeks === 1 ? '1wk' : weeks === 2 ? '2wk' : '3wk';

  if (format === 'excel') {
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, `pelican-schedule-${dateLabel}-${weekLabel}.xlsx`);
  } else if (format === 'pdf' || format === 'print') {
    // Render the workbook into an HTML table, open in a new window, then
    // trigger print (for "print") or use the browser's "Save as PDF"
    // print destination (for "pdf"). Both use the same code path since
    // the browser print dialog handles both.
    const html = await workbookToHtml(wb);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    // Give the page a moment to render before triggering print
    setTimeout(() => w.print(), 400);
  }
}

// Keep the old name as an alias for backward compat (won't break anything)
export const exportScheduleXlsx = (opts: Omit<ExportOptions, 'weeks' | 'format'>) =>
  exportSchedule({ ...opts, weeks: 3, format: 'excel' });

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function workbookToHtml(wb: import('exceljs').Workbook): Promise<string> {
  const ws = wb.worksheets[0];
  if (!ws) return '';

  let rows = '';
  ws.eachRow((row, rowNum) => {
    let cells = '';
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const val = cell.value ?? '';
      const font = cell.font as any;
      const fill = cell.fill as any;
      const align = cell.alignment as any;

      let style = 'padding:4px 6px;border:1px solid #bbb;';
      if (align?.horizontal === 'center' || align?.horizontal === 'centerContinuous') style += 'text-align:center;';
      if (font?.bold) style += 'font-weight:600;';
      if (font?.size) style += `font-size:${font.size}px;`;
      if (font?.color?.argb) {
        const c = font.color.argb;
        style += `color:#${c.length === 8 ? c.slice(2) : c};`;
      }
      if (fill?.fgColor?.argb) {
        const c = fill.fgColor.argb;
        style += `background:#${c.length === 8 ? c.slice(2) : c};`;
      }
      if (align?.wrapText) style += 'white-space:pre-wrap;';

      const tag = rowNum <= 4 ? 'th' : 'td';
      const display = typeof val === 'object' ? '' : String(val);
      cells += `<${tag} style="${style}">${display.replace(/\n/g, '<br>')}</${tag}>`;
    });
    rows += `<tr>${cells}</tr>`;
  });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Schedule</title>
<style>
  @page { size: landscape; margin: 0.4in; }
  @media print { .no-print { display: none !important; } }
  body { font-family: Calibri, -apple-system, sans-serif; margin: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  .no-print { margin-bottom: 12px; }
</style></head><body>
<div class="no-print"><button onclick="window.print()" style="padding:6px 16px;font-size:13px;cursor:pointer;">Print / Save as PDF</button></div>
<table>${rows}</table>
</body></html>`;
}
