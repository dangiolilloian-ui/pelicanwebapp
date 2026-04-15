'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { getWeekStart, addDays } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import type { Shift } from '@/types';

// Printable weekly schedule. Opens in its own tab from the calendar page and
// auto-triggers the browser print dialog after the data loads, so a manager
// can cmd/ctrl+P to paper in two clicks. The layout is deliberately plain:
// no colors beyond light grey dividers so it still reads well on a B/W laser
// printer, and sized for landscape US letter/A4.


function fmtTime(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${m.toString().padStart(2, '0')}${ampm}`;
}

function fmtDateShort(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function SchedulePrintPage() {
  const t = useT();
  const { token } = useAuth();
  const params = useSearchParams();
  const startParam = params.get('start');
  const [shifts, setShifts] = useState<Shift[] | null>(null);

  const weekStart = startParam ? new Date(startParam) : getWeekStart(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const DAY_LABELS = [t('monthCal.sun'), t('monthCal.mon'), t('monthCal.tue'), t('monthCal.wed'), t('monthCal.thu'), t('monthCal.fri'), t('monthCal.sat')];

  useEffect(() => {
    if (!token) return;
    const start = weekStart.toISOString();
    const end = addDays(weekStart, 7).toISOString();
    api<Shift[]>(`/shifts?start=${start}&end=${end}`, { token }).then(setShifts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, startParam]);

  useEffect(() => {
    // Small delay so the DOM has a frame to paint before the print dialog
    // pops — otherwise Safari sometimes prints a half-empty page.
    if (shifts !== null) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [shifts]);

  if (shifts === null) {
    return <div className="p-8 text-sm text-gray-500">{t('common.loading')}</div>;
  }

  // Group shifts by (user, day).  We sort users alphabetically so the sheet
  // is consistent week-over-week — makes it easier for staff to scan to their
  // own row every time.
  const byUser = new Map<string, { name: string; cells: Shift[][] }>();
  for (const s of shifts) {
    const uid = s.user?.id || 'UNASSIGNED';
    const name = s.user ? `${s.user.firstName} ${s.user.lastName}` : t('common.unassigned');
    if (!byUser.has(uid)) {
      byUser.set(uid, { name, cells: Array.from({ length: 7 }, () => []) });
    }
    const sd = new Date(s.startTime);
    const dayIdx = days.findIndex((d) => sameDay(d, sd));
    if (dayIdx >= 0) byUser.get(uid)!.cells[dayIdx].push(s);
  }
  const unassignedLabel = t('common.unassigned');
  const rows = [...byUser.values()].sort((a, b) => {
    // Push Unassigned to the bottom
    if (a.name === unassignedLabel) return 1;
    if (b.name === unassignedLabel) return -1;
    return a.name.localeCompare(b.name);
  });

  const rangeLabel = `${fmtDateShort(days[0])} – ${fmtDateShort(days[6])}, ${days[0].getFullYear()}`;

  return (
    <div className="print-root">
      <style>{`
        @page { size: landscape; margin: 0.4in; }
        @media print {
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
        }
        .print-root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; padding: 16px; }
        .print-table { width: 100%; border-collapse: collapse; font-size: 10px; }
        .print-table th, .print-table td { border: 1px solid #bbb; padding: 4px 5px; vertical-align: top; }
        .print-table th { background: #f2f2f2; font-weight: 600; text-align: left; }
        .print-table td.name { font-weight: 600; white-space: nowrap; }
        .print-shift { display: block; margin-bottom: 2px; line-height: 1.15; }
        .print-shift .time { font-weight: 600; }
        .print-shift .meta { color: #555; font-size: 9px; }
        .print-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
        .print-header h1 { font-size: 16px; font-weight: 700; margin: 0; }
        .print-header .sub { font-size: 11px; color: #555; }
        .print-footer { margin-top: 10px; font-size: 9px; color: #777; text-align: right; }
      `}</style>

      <div className="print-header">
        <div>
          <h1>{t('schedule.weeklySchedule')}</h1>
          <div className="sub">{rangeLabel}</div>
        </div>
        <button className="no-print rounded-md border px-3 py-1 text-xs" onClick={() => window.print()}>
          {t('schedule.print')}
        </button>
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th style={{ width: '12%' }}>{t('schedule.employee')}</th>
            {days.map((d, i) => (
              <th key={i}>
                {DAY_LABELS[d.getDay()]} {d.getMonth() + 1}/{d.getDate()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} style={{ textAlign: 'center', padding: 20, color: '#888' }}>
                {t('schedule.noShiftsThisWeek')}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.name}>
                <td className="name">{row.name}</td>
                {row.cells.map((cell, i) => (
                  <td key={i}>
                    {cell
                      .sort((a, b) => a.startTime.localeCompare(b.startTime))
                      .map((s) => (
                        <span key={s.id} className="print-shift">
                          <span className="time">
                            {fmtTime(s.startTime)}–{fmtTime(s.endTime)}
                          </span>
                          {(s.position || s.location) && (
                            <span className="meta">
                              {' '}
                              {s.position?.name}
                              {s.position && s.location ? ' · ' : ''}
                              {s.location?.name}
                            </span>
                          )}
                        </span>
                      ))}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div className="print-footer">{t('schedule.printed', { date: new Date().toLocaleString() })}</div>
    </div>
  );
}
