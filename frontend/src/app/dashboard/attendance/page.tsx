'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface Incident {
  kind: 'noShow' | 'late' | 'earlyOut';
  pts: number;
  shiftId: string;
  startTime?: string;
  endTime?: string;
  clockIn?: string;
  clockOut?: string;
  lateMinutes?: number;
  earlyMinutes?: number;
}

interface EmployeeRow {
  id: string;
  name: string;
  points: number;
  status: 'clear' | 'warn' | 'final';
  noShow: number;
  late: number;
  earlyOut: number;
  incidents: Incident[];
}

interface Config {
  windowDays: number;
  thresholdWarn: number;
  thresholdFinal: number;
  pointsNoShow: number;
  pointsLate: number;
  pointsEarlyOut: number;
}

const statusBadge: Record<string, string> = {
  clear: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  final: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

export default function AttendancePage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{t('attendance.title')}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        {t('attendance.desc')}
      </p>
      {isManager ? <ManagerView token={token} /> : <EmployeeView token={token} />}
    </div>
  );
}

/* ─── Employee self-service ─── */
function EmployeeView({ token }: { token: string | null }) {
  const t = useT();
  const [data, setData] = useState<(EmployeeRow & { config: Config; windowStart: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api<any>('/reports/my-attendance', { token })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Spinner />;
  if (!data) return <p className="text-sm text-gray-500">{t('attendance.loadError')}</p>;

  const pct = data.config.thresholdFinal > 0 ? Math.min(data.points / data.config.thresholdFinal, 1) : 0;

  return (
    <div className="space-y-6">
      {/* Score card */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">{data.points}</div>
            <div className="text-xs text-gray-500">{t('attendance.pointsInDays', { n: data.config.windowDays })}</div>
          </div>
          <span className={clsx('rounded-full px-3 py-1 text-xs font-semibold uppercase', statusBadge[data.status])}>
            {data.status}
          </span>
        </div>
        {/* Progress bar */}
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all',
              data.status === 'final' ? 'bg-red-500' : data.status === 'warn' ? 'bg-amber-500' : 'bg-green-500'
            )}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
          <span>0</span>
          <span>{t('attendance.warn', { n: data.config.thresholdWarn })}</span>
          <span>{t('attendance.final', { n: data.config.thresholdFinal })}</span>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label={t('attendance.noShows')} value={data.noShow} pts={data.noShow * data.config.pointsNoShow} color="red" t={t} />
        <StatCard label={t('attendance.late')} value={data.late} pts={data.late * data.config.pointsLate} color="amber" t={t} />
        <StatCard label={t('attendance.earlyOut')} value={data.earlyOut} pts={data.earlyOut * data.config.pointsEarlyOut} color="amber" t={t} />
      </div>

      {/* Timeline */}
      {data.incidents.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('attendance.incidentHistory')}</h3>
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.incidents.map((inc, i) => (
              <IncidentRow key={i} inc={inc} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── Manager view ─── */
function ManagerView({ token }: { token: string | null }) {
  const t = useT();
  const [data, setData] = useState<{ config: Config; windowStart: string; byEmployee: EmployeeRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'warn' | 'final'>('all');

  useEffect(() => {
    if (!token) return;
    api<any>('/reports/attendance-points', { token })
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Spinner />;
  if (!data) return <p className="text-sm text-gray-500">{t('attendance.loadError')}</p>;

  const { config, byEmployee } = data;
  const filtered = filter === 'all'
    ? byEmployee
    : byEmployee.filter((r) => r.status === filter || (filter === 'warn' && r.status === 'final'));

  const warnCount = byEmployee.filter((r) => r.status === 'warn').length;
  const finalCount = byEmployee.filter((r) => r.status === 'final').length;

  return (
    <div className="space-y-4">
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
          {t('attendance.all', { n: byEmployee.length })}
        </Pill>
        <Pill active={filter === 'warn'} onClick={() => setFilter('warn')} color="amber">
          {t('attendance.warning', { n: warnCount })}
        </Pill>
        <Pill active={filter === 'final'} onClick={() => setFilter('final')} color="red">
          {t('attendance.finalFilter', { n: finalCount })}
        </Pill>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('attendance.configSummary', { window: config.windowDays, noShow: config.pointsNoShow, late: config.pointsLate, early: config.pointsEarlyOut, warn: config.thresholdWarn, final: config.thresholdFinal })}
      </p>

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          {filter === 'all' ? t('attendance.cleanSheet') : t('attendance.noEmployees')}
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left text-xs text-gray-500 dark:text-gray-400">
                <th className="px-4 py-2 font-medium">{t('attendance.employee')}</th>
                <th className="px-4 py-2 font-medium text-center">{t('attendance.points')}</th>
                <th className="px-4 py-2 font-medium text-center">{t('attendance.status')}</th>
                <th className="px-4 py-2 font-medium text-center">{t('attendance.noShow')}</th>
                <th className="px-4 py-2 font-medium text-center">{t('attendance.late')}</th>
                <th className="px-4 py-2 font-medium text-center">{t('attendance.early')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((row) => (
                <tr key={row.id} className="group">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                      className="text-gray-900 dark:text-gray-100 font-medium hover:text-indigo-600 dark:hover:text-indigo-400 text-left"
                    >
                      {row.name}
                      <span className="text-gray-400 text-xs ml-1">{expanded === row.id ? '▾' : '▸'}</span>
                    </button>
                    {expanded === row.id && row.incidents.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {row.incidents.map((inc, i) => (
                          <IncidentRow key={i} inc={inc} compact />
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center font-bold tabular-nums">{row.points}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', statusBadge[row.status])}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-400">{row.noShow}</td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-400">{row.late}</td>
                  <td className="px-4 py-2 text-center tabular-nums text-gray-600 dark:text-gray-400">{row.earlyOut}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Shared atoms ─── */

function IncidentRow({ inc, compact }: { inc: Incident; compact?: boolean }) {
  const t = useT();
  const kindLabel = inc.kind === 'noShow' ? t('attendance.noShowBadge') : inc.kind === 'late' ? t('attendance.lateBadge') : t('attendance.earlyOutBadge');
  const kindColor = inc.kind === 'noShow' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';

  const detail = (() => {
    if (inc.kind === 'noShow' && inc.startTime)
      return t('attendance.shiftDate', { date: new Date(inc.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
    if (inc.kind === 'late' && inc.lateMinutes != null)
      return t('attendance.minLate', { n: inc.lateMinutes, date: new Date(inc.startTime!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    if (inc.kind === 'earlyOut' && inc.earlyMinutes != null)
      return t('attendance.leftEarly', { n: inc.earlyMinutes, date: new Date(inc.endTime!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
    return '';
  })();

  return (
    <li className={clsx('flex items-center justify-between', compact ? 'text-[10px] text-gray-500 py-0.5' : 'px-4 py-2 text-xs text-gray-600 dark:text-gray-400')}>
      <span className="flex items-center gap-2">
        <span className={clsx('rounded px-1.5 py-0.5 text-[9px] font-semibold', kindColor)}>{kindLabel}</span>
        <span>{detail}</span>
      </span>
      <span className="text-gray-400">+{inc.pts}</span>
    </li>
  );
}

function StatCard({ label, value, pts, color, t }: { label: string; value: number; pts: number; color: string; t: ReturnType<typeof useT> }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 text-center">
      <div className={clsx('text-2xl font-bold', `text-${color}-600 dark:text-${color}-400`)}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-[10px] text-gray-400 mt-0.5">{pts} {t('attendance.pts')}</div>
    </div>
  );
}

function Pill({ children, active, onClick, color }: { children: React.ReactNode; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-full px-3 py-1 text-xs font-medium transition',
        active
          ? color === 'red'
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : color === 'amber'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
            : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      )}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
    </div>
  );
}
