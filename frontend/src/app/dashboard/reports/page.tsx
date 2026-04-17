'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getWeekStart, addDays, toDateInputValue } from '@/lib/dates';
import { AttendancePointsSection } from '@/components/AttendancePointsSection';
import { DailySalesSection } from '@/components/DailySalesSection';
import { useLocations } from '@/hooks/useLocations';
import { useT } from '@/lib/i18n';

interface Report {
  range: { start: string; end: string };
  totalShifts: number;
  totalHours: number;
  totalCost: number;
  totalSales: number;
  laborPct: number | null;
  byLocation: { id: string; name: string; hours: number; cost: number; shifts: number; budget: number | null; sales: number; laborPct: number | null }[];
  byPosition: { id: string; name: string; color: string; rate: number; hours: number; cost: number; shifts: number }[];
  byEmployee: { id: string; name: string; hours: number; cost: number; shifts: number }[];
  byDay: { date: string; hours: number; cost: number; shifts: number }[];
}

interface AttendanceIncident {
  kind: 'late' | 'no-show';
  shiftId: string;
  startTime: string;
  clockIn?: string;
  lateMinutes?: number;
}

interface AttendanceReport {
  range: { start: string; end: string };
  totalShifts: number;
  onTime: number;
  late: number;
  noShow: number;
  byEmployee: {
    id: string;
    name: string;
    total: number;
    onTime: number;
    late: number;
    noShow: number;
    totalLateMinutes: number;
    incidents: AttendanceIncident[];
  }[];
}

const money = (v: number) =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function ReportsPage() {
  const { token, user } = useAuth();
  const { locations } = useLocations();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [start, setStart] = useState(() => toDateInputValue(getWeekStart(new Date())));
  const [end, setEnd] = useState(() => toDateInputValue(addDays(getWeekStart(new Date()), 6)));
  const [data, setData] = useState<Report | null>(null);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [minorReport, setMinorReport] = useState<{
    users: Array<{ userId: string; name: string; birthDate: string; violations: string[] }>;
    totalViolations: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = `start=${new Date(start).toISOString()}&end=${new Date(end + 'T23:59:59').toISOString()}`;
      const [labor, att, minor] = await Promise.all([
        api<Report>(`/reports/labor?${qs}`, { token }),
        api<AttendanceReport>(`/reports/attendance?${qs}`, { token }),
        api<{ users: any[]; totalViolations: number }>(`/reports/minor-compliance?${qs}`, { token }).catch(() => ({ users: [], totalViolations: 0 })),
      ]);
      setData(labor);
      setAttendance(att);
      setMinorReport(minor);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isManager) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!isManager) {
    return <div className="p-6 text-gray-600 dark:text-gray-400">{t('reports.managerOnly')}</div>;
  }

  const setQuickRange = (kind: 'thisWeek' | 'lastWeek' | 'thisMonth') => {
    const now = new Date();
    if (kind === 'thisWeek') {
      const s = getWeekStart(now);
      setStart(toDateInputValue(s));
      setEnd(toDateInputValue(addDays(s, 6)));
    } else if (kind === 'lastWeek') {
      const s = addDays(getWeekStart(now), -7);
      setStart(toDateInputValue(s));
      setEnd(toDateInputValue(addDays(s, 6)));
    } else {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStart(toDateInputValue(s));
      setEnd(toDateInputValue(e));
    }
  };

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ['Section', 'Name', 'Shifts', 'Hours', 'Cost'],
      ...data.byEmployee.map((e) => ['Employee', e.name, e.shifts, e.hours, e.cost]),
      ...data.byPosition.map((p) => ['Position', p.name, p.shifts, p.hours, p.cost]),
      ...data.byLocation.map((l) => ['Location', l.name, l.shifts, l.hours, l.cost]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pelican-report-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Payroll CSV is served as a file directly by the backend. Fetch with the
  // auth header, then hand the blob to a virtual download link.
  const downloadPayroll = async () => {
    if (!token) return;
    const qs = `start=${new Date(start).toISOString()}&end=${new Date(end + 'T23:59:59').toISOString()}`;
    const res = await fetch(`/api/reports/payroll?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || t('reports.payrollExportFailed'));
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pelican-payroll-${start}-to-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const maxDayHours = data ? Math.max(1, ...data.byDay.map((d) => d.hours)) : 1;

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">{t('reports.title')}</h1>

      {/* Range picker */}
      <div className="flex flex-wrap items-end gap-3 mb-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('reports.start')}</label>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t('reports.end')}</label>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {loading ? t('common.loading') : t('reports.runReport')}
        </button>
        <div className="flex gap-1 ml-2">
          <button onClick={() => setQuickRange('thisWeek')} className="text-xs rounded border border-gray-300 dark:border-gray-700 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
            {t('reports.thisWeek')}
          </button>
          <button onClick={() => setQuickRange('lastWeek')} className="text-xs rounded border border-gray-300 dark:border-gray-700 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
            {t('reports.lastWeek')}
          </button>
          <button onClick={() => setQuickRange('thisMonth')} className="text-xs rounded border border-gray-300 dark:border-gray-700 px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
            {t('reports.thisMonth')}
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            onClick={downloadPayroll}
            className="rounded-lg bg-green-600 text-white px-3 py-2 text-sm font-medium hover:bg-green-700"
            title={t('reports.payrollTooltip')}
          >
            {t('reports.payrollCsv')}
          </button>
          {data && (
            <button
              onClick={exportCSV}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('reports.reportCsv')}
            </button>
          )}
        </div>
      </div>

      {isManager && locations.length > 0 && <DailySalesSection locations={locations} />}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Kpi label={t('reports.shifts')} value={data.totalShifts.toString()} />
            <Kpi label={t('reports.totalHours')} value={`${data.totalHours.toFixed(0)}h`} />
            <Kpi label={t('reports.estLaborCost')} value={money(data.totalCost)} accent="indigo" />
            <Kpi
              label={t('reports.laborPctSales')}
              value={data.laborPct != null ? `${data.laborPct.toFixed(1)}%` : '—'}
              accent={data.laborPct != null && data.laborPct > 35 ? 'red' : undefined}
            />
          </div>
          {data.totalSales > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-4 mb-6">
              {t('reports.salesBasis', { money: money(data.totalSales) })}
            </p>
          )}

          {/* By day chart */}
          <Section title={t('reports.hoursByDay')}>
            <div className="flex items-end gap-2 h-40">
              {data.byDay.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 tabular-nums">{d.hours}h</div>
                  <div
                    className="w-full bg-indigo-500 rounded-t"
                    style={{ height: `${(d.hours / maxDayHours) * 100}%` }}
                  />
                  <div className="text-[10px] text-gray-400">
                    {new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <Section title={t('reports.topEmployees')}>
              <Table rows={data.byEmployee.slice(0, 10).map((e) => [e.name, `${e.hours}h`, money(e.cost)])} />
            </Section>
            <Section title={t('reports.costByPosition')}>
              <ul className="space-y-2">
                {data.byPosition.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-gray-400 tabular-nums">{p.hours}h</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100 tabular-nums w-20 text-right">{money(p.cost)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          <Section title={t('reports.costByLocation')} className="mt-4">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left py-1.5">{t('reports.location')}</th>
                  <th className="text-right py-1.5">{t('reports.shifts')}</th>
                  <th className="text-right py-1.5">{t('reports.totalHours')}</th>
                  <th className="text-right py-1.5">{t('reports.cost')}</th>
                  <th className="text-right py-1.5">{t('reports.sales')}</th>
                  <th className="text-right py-1.5">{t('reports.laborPct')}</th>
                  <th className="text-right py-1.5">{t('reports.budgetCol')}</th>
                  <th className="text-right py-1.5 w-24">{t('reports.used')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.byLocation.map((l) => {
                  const pct = l.budget && l.budget > 0 ? l.cost / l.budget : null;
                  const over = pct != null && pct >= 1;
                  const warn = pct != null && pct >= 0.9 && !over;
                  return (
                    <tr key={l.id}>
                      <td className="py-1.5 text-gray-700 dark:text-gray-300">{l.name}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100">{l.shifts}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100">{l.hours}h</td>
                      <td className="py-1.5 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">{money(l.cost)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                        {l.sales > 0 ? money(l.sales) : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                        {l.laborPct != null ? `${l.laborPct.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500 dark:text-gray-400">
                        {l.budget ? money(l.budget) : '—'}
                      </td>
                      <td className="py-1.5 text-right">
                        {pct != null ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-14 rounded-full bg-gray-200 dark:bg-gray-800 overflow-hidden">
                              <div
                                className={`h-full ${over ? 'bg-red-500' : warn ? 'bg-amber-500' : 'bg-indigo-500'}`}
                                style={{ width: `${Math.min(100, pct * 100)}%` }}
                              />
                            </div>
                            <span className={`text-xs tabular-nums ${over ? 'text-red-600 font-medium' : warn ? 'text-amber-600' : 'text-gray-500'}`}>
                              {Math.round(pct * 100)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          {attendance && attendance.totalShifts > 0 && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
                <Kpi label={t('reports.finishedShifts')} value={attendance.totalShifts.toString()} />
                <Kpi label={t('reports.onTime')} value={attendance.onTime.toString()} />
                <Kpi
                  label={t('attendance.late')}
                  value={attendance.late.toString()}
                  accent={attendance.late > 0 ? 'amber' : undefined}
                />
                <Kpi
                  label={t('reports.noShows')}
                  value={attendance.noShow.toString()}
                  accent={attendance.noShow > 0 ? 'red' : undefined}
                />
              </div>

              <Section title={t('reports.attendanceByEmployee')} className="mt-4">
                {attendance.byEmployee.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('reports.noFinishedShifts')}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="text-left py-1.5">{t('attendance.employee')}</th>
                        <th className="text-right py-1.5">{t('reports.shifts')}</th>
                        <th className="text-right py-1.5">{t('reports.onTimeCol')}</th>
                        <th className="text-right py-1.5">{t('attendance.late')}</th>
                        <th className="text-right py-1.5">{t('reports.noShowCol')}</th>
                        <th className="text-right py-1.5">{t('reports.lateMin')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {attendance.byEmployee.map((e) => (
                        <tr key={e.id}>
                          <td className="py-1.5 text-gray-700 dark:text-gray-300">{e.name}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100">{e.total}</td>
                          <td className="py-1.5 text-right tabular-nums text-green-600">{e.onTime}</td>
                          <td className={`py-1.5 text-right tabular-nums ${e.late > 0 ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>{e.late}</td>
                          <td className={`py-1.5 text-right tabular-nums ${e.noShow > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{e.noShow}</td>
                          <td className="py-1.5 text-right tabular-nums text-gray-700 dark:text-gray-300">{e.totalLateMinutes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>
            </>
          )}

          {minorReport && minorReport.users.length > 0 && (
            <Section title={t('reports.minorCompliance', { n: minorReport.totalViolations })} className="mt-4">
              <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                {t('reports.minorComplianceDesc')}
              </p>
              <ul className="space-y-3">
                {minorReport.users.map((u) => (
                  <li key={u.userId} className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">{u.name}</span>
                      <span className="text-[10px] text-amber-700 dark:text-amber-400">DOB {u.birthDate?.slice(0, 10)}</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {u.violations.map((v, i) => (
                        <li key={i} className="text-xs text-amber-800 dark:text-amber-300">• {v}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <AttendancePointsSection />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: 'indigo' | 'amber' | 'red' }) {
  const accentClass =
    accent === 'indigo'
      ? 'text-indigo-600'
      : accent === 'amber'
      ? 'text-amber-600'
      : accent === 'red'
      ? 'text-red-600'
      : 'text-gray-900 dark:text-gray-100';
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accentClass}`}>{value}</p>
    </div>
  );
}

function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Table({ rows }: { rows: (string | number)[][] }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td
                key={j}
                className={`py-1.5 ${j === 0 ? 'text-gray-700 dark:text-gray-300' : 'text-right tabular-nums text-gray-900 dark:text-gray-100'} ${
                  j === r.length - 1 ? 'font-medium' : ''
                }`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
