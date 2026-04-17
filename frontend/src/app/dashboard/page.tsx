'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { AnnouncementsBar } from '@/components/AnnouncementsBar';
import { ExpiringCertsCard } from '@/components/ExpiringCertsCard';
import { LiveRosterWidget } from '@/components/LiveRosterWidget';
import { OnboardingPendingWidget } from '@/components/OnboardingPendingWidget';
import { TodaySnapshotCard } from '@/components/TodaySnapshotCard';
import { ShiftChecklistCard } from '@/components/ShiftChecklistCard';
import clsx from 'clsx';

interface Stats {
  totalEmployees: number;
  totalShifts: number;
  totalHours: number;
  drafts: number;
  published: number;
  unassigned: number;
  pendingTimeOff: number;
  topWorkers: { id: string; name: string; hours: number; shifts: number }[];
  byLocation: { location: string; shifts: number; hours: number }[];
  byPosition: { position: string; shifts: number; color: string }[];
}

interface MyStats {
  weekShifts: number;
  weekHours: number;
  upcomingShifts: Array<{
    id: string;
    startTime: string;
    endTime: string;
    confirmedAt: string | null;
    position: { name: string; color: string } | null;
    location: { name: string } | null;
  }>;
  openSwaps: Array<{
    id: string;
    message: string | null;
    shift: {
      startTime: string;
      endTime: string;
      position: { name: string; color: string } | null;
      location: { name: string } | null;
    };
    requester: { firstName: string; lastName: string };
  }>;
  pendingTimeOff: number;
  clockedIn: boolean;
  activeClockInAt: string | null;
}

export default function OverviewPage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<MyStats | null>(null);

  useEffect(() => {
    if (!token) return;
    if (isManager) {
      api<Stats>('/dashboard/stats', { token }).then(setStats).catch(console.error);
    } else {
      api<MyStats>('/dashboard/me', { token }).then(setMine).catch(console.error);
    }
  }, [token, isManager]);

  if (isManager ? !stats : !mine) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (!isManager && mine) {
    return <EmployeeOverview mine={mine} firstName={user?.firstName || ''} token={token || ''} onRefresh={() => api<MyStats>('/dashboard/me', { token: token || '' }).then(setMine).catch(console.error)} />;
  }

  if (!stats) return null;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('dashboard.title')}</h1>

      <TodaySnapshotCard />
      <AnnouncementsBar />
      <ExpiringCertsCard />
      <LiveRosterWidget />
      <OnboardingPendingWidget />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label={t('dashboard.employees')} value={stats.totalEmployees} color="indigo" />
        <Card label={t('dashboard.shiftsThisWeek')} value={stats.totalShifts} color="blue" />
        <Card label={t('dashboard.totalHours')} value={`${stats.totalHours}h`} color="green" />
        <Card label={t('dashboard.pendingTimeOff')} value={stats.pendingTimeOff} color="amber" href="/dashboard/timeoff" />
      </div>

      {/* Shift status row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.published')}</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{stats.published}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.drafts')}</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{stats.drafts}</p>
        </div>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.unassigned')}</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{stats.unassigned}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Workers */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.topHours')}</h2>
          <div className="space-y-2">
            {stats.topWorkers.map((w, i) => (
              <div key={w.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-400 w-4">{i + 1}</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">{w.name}</span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{w.hours.toFixed(1)}h</span>
                  <span className="text-xs text-gray-400 ml-1">({w.shifts}s)</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* By Location */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.byLocation')}</h2>
          <div className="space-y-3">
            {stats.byLocation.map((l) => {
              const pct = stats.totalShifts > 0 ? (l.shifts / stats.totalShifts) * 100 : 0;
              return (
                <div key={l.location}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-700 dark:text-gray-300">{l.location}</span>
                    <span className="text-gray-500 dark:text-gray-400">{l.shifts} shifts / {l.hours.toFixed(0)}h</span>
                  </div>
                  <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* By Position */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.byPosition')}</h2>
          <div className="space-y-2">
            {stats.byPosition.slice(0, 10).map((p) => (
              <div key={p.position} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{p.position}</span>
                </div>
                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{p.shifts}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeeOverview({ mine, firstName, token, onRefresh }: { mine: MyStats; firstName: string; token: string; onRefresh: () => void }) {
  const t = useT();
  const next = mine.upcomingShifts[0];
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [droppingId, setDroppingId] = useState<string | null>(null);
  const unconfirmedCount = mine.upcomingShifts.filter((s) => !s.confirmedAt).length;

  const confirmShift = async (id: string) => {
    setConfirmingId(id);
    try {
      await api(`/shifts/${id}/confirm`, { token, method: 'POST' });
      onRefresh();
    } catch (e) {
      console.error(e);
    } finally {
      setConfirmingId(null);
    }
  };

  const [prevHandoff, setPrevHandoff] = useState<{ note: string; author: string | null; endTime: string } | null>(null);
  useEffect(() => {
    if (!next) {
      setPrevHandoff(null);
      return;
    }
    let cancelled = false;
    api<{ handoff: { note: string; author: string | null; endTime: string } | null }>(
      `/shifts/${next.id}/previous-handoff`,
      { token }
    )
      .then((r) => {
        if (!cancelled) setPrevHandoff(r.handoff);
      })
      .catch(() => {
        if (!cancelled) setPrevHandoff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [next, token]);

  const dropShift = async (id: string) => {
    if (!confirm("Drop this shift? Your manager will be notified and it'll go back to the open list.")) return;
    setDroppingId(id);
    try {
      await api(`/shifts/${id}/drop`, { token, method: 'POST' });
      onRefresh();
    } catch (e) {
      alert((e as Error).message || 'Failed to drop shift');
    } finally {
      setDroppingId(null);
    }
  };
  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('dashboard.greeting', { name: firstName })} 👋</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('dashboard.weekGlance')}</p>
      </div>

      <AnnouncementsBar />
      <ShiftChecklistCard />

      {/* Quick KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label={t('dashboard.shiftsThisWeek')} value={mine.weekShifts} color="indigo" />
        <Card label={t('dashboard.hoursThisWeek')} value={`${mine.weekHours}h`} color="green" />
        <Card label={t('dashboard.pendingTimeOff')} value={mine.pendingTimeOff} color="amber" href="/dashboard/timeoff" />
        <div className={clsx(
          'rounded-xl border p-4',
          mine.clockedIn ? 'border-green-300 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-800'
        )}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.clockStatus')}</p>
          <p className={clsx('text-xl font-bold mt-1', mine.clockedIn ? 'text-green-600' : 'text-gray-400')}>
            {mine.clockedIn ? t('dashboard.clockedIn') : t('dashboard.offTheClock')}
          </p>
          <a href="/dashboard/timeclock" className="text-xs text-indigo-600 hover:underline">{t('dashboard.goToTimeClock')}</a>
        </div>
      </div>

      {/* Next shift hero */}
      {next && (
        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-900/20 dark:to-gray-900 dark:border-indigo-800 p-5">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">{t('dashboard.yourNextShift')}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">
            {formatDate(new Date(next.startTime))}
          </p>
          <p className="text-lg text-gray-700 dark:text-gray-300">
            {formatTime(next.startTime)} – {formatTime(next.endTime)}
          </p>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-600 dark:text-gray-400">
            {next.position && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: next.position.color }} />
                {next.position.name}
              </span>
            )}
            {next.location && <span>· {next.location.name}</span>}
          </div>
          {prevHandoff && (
            <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-200 uppercase tracking-wide">
                {t('dashboard.handoffNote')}
              </p>
              <p className="text-sm text-amber-900 dark:text-amber-100 whitespace-pre-wrap mt-0.5">
                {prevHandoff.note}
              </p>
              {prevHandoff.author && (
                <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-1">
                  — {prevHandoff.author}, {new Date(prevHandoff.endTime).toLocaleDateString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Unconfirmed banner */}
      {unconfirmedCount > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {t('dashboard.unconfirmedBanner', { n: unconfirmedCount })}
          </p>
        </div>
      )}

      {/* Upcoming shifts list */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('dashboard.upcomingShifts')}</h2>
        {mine.upcomingShifts.length === 0 ? (
          <p className="text-sm text-gray-400">{t('dashboard.noUpcoming')}</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {mine.upcomingShifts.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {formatDate(new Date(s.startTime))}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatTime(s.startTime)} – {formatTime(s.endTime)}
                    {s.location ? ` · ${s.location.name}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {s.position && (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.position.color }} />
                      {s.position.name}
                    </span>
                  )}
                  {s.confirmedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 text-[10px] font-medium">
                      {t('dashboard.confirmed')}
                    </span>
                  ) : (
                    <button
                      onClick={() => confirmShift(s.id)}
                      disabled={confirmingId === s.id}
                      className="rounded-lg bg-indigo-600 text-white px-3 py-1 text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {confirmingId === s.id ? t('dashboard.confirming') : t('common.confirm')}
                    </button>
                  )}
                  <button
                    onClick={() => dropShift(s.id)}
                    disabled={droppingId === s.id}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-[11px] font-medium text-gray-600 dark:text-gray-400 hover:bg-red-50 hover:text-red-700 hover:border-red-300 disabled:opacity-50"
                    title={t('dashboard.dropShift')}
                  >
                    {droppingId === s.id ? t('dashboard.dropping') : t('dashboard.drop')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Open swaps I can grab */}
      {mine.openSwaps.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('dashboard.openShiftsPickUp')}</h2>
            <a href="/dashboard/swaps" className="text-xs text-indigo-600 hover:underline">{t('dashboard.viewAll')}</a>
          </div>
          <ul className="space-y-2">
            {mine.openSwaps.slice(0, 5).map((sw) => (
              <li key={sw.id} className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {formatDate(new Date(sw.shift.startTime))} · {formatTime(sw.shift.startTime)}–{formatTime(sw.shift.endTime)}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                    {t('dashboard.from', { name: `${sw.requester.firstName} ${sw.requester.lastName}` })}
                    {sw.shift.position ? ` · ${sw.shift.position.name}` : ''}
                  </p>
                </div>
                <a href="/dashboard/swaps" className="text-xs rounded bg-blue-600 text-white px-3 py-1 hover:bg-blue-700 shrink-0 ml-2">
                  {t('dashboard.review')}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, href }: { label: string; value: string | number; color: string; href?: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  const inner = (
    <div className={clsx('rounded-xl border border-gray-200 dark:border-gray-800 p-4', href && 'hover:border-indigo-300 transition cursor-pointer')}>
      <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      <p className={clsx('text-3xl font-bold mt-1', colors[color])}>{value}</p>
    </div>
  );
  return href ? <a href={href}>{inner}</a> : inner;
}
