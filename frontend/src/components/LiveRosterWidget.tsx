'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface WorkingRow {
  userId: string;
  name: string;
  clockIn: string;
  scheduledEnd: string | null;
  locationName: string | null;
  positionName: string | null;
  positionColor: string | null;
  breakStartedAt: string | null;
}

interface AbsentRow {
  userId: string;
  name: string;
  scheduledStart: string;
  scheduledEnd: string;
  locationName: string | null;
  positionName: string | null;
  minutesLate: number;
}

interface Roster {
  generatedAt: string;
  working: WorkingRow[];
  onBreak: WorkingRow[];
  absent: AbsentRow[];
}

// Manager-only live roster. Refreshes every 30s so it reflects recent
// clock-ins without hammering the API. Deliberately terse layout — this is
// meant to live as a side panel on the overview, not a full page.
export function LiveRosterWidget() {
  const t = useT();
  const { token } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await api<Roster>('/dashboard/live-roster', { token });
        if (alive) setRoster(data);
      } catch (e: any) {
        if (alive) setError(e.message || 'Failed to load');
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  if (error && !roster) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm text-red-600">
        {t('liveRoster.error', { error })}
      </div>
    );
  }

  if (!roster) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <div className="h-5 w-24 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  const total = roster.working.length + roster.onBreak.length + roster.absent.length;

  const fmtHM = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('liveRoster.title')}</h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('liveRoster.updated', { time: fmtHM(roster.generatedAt) })}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" /> {roster.working.length}</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> {roster.onBreak.length}</span>
          {roster.absent.length > 0 && (
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> {roster.absent.length}</span>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">{t('liveRoster.empty')}</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-y-auto">
          {roster.absent.map((r) => (
            <Row
              key={'a' + r.userId}
              dot="bg-red-500"
              name={r.name}
              subline={`${t('liveRoster.late', { n: r.minutesLate })} · ${r.positionName || '—'}${r.locationName ? ' · ' + r.locationName : ''}`}
              right={t('liveRoster.sched', { time: fmtHM(r.scheduledStart) })}
              tone="red"
            />
          ))}
          {roster.onBreak.map((r) => (
            <Row
              key={'b' + r.userId}
              dot="bg-amber-500"
              name={r.name}
              subline={`${t('liveRoster.onBreak')} · ${r.positionName || '—'}${r.locationName ? ' · ' + r.locationName : ''}`}
              right={r.breakStartedAt ? t('liveRoster.since', { time: fmtHM(r.breakStartedAt) }) : ''}
              tone="amber"
            />
          ))}
          {roster.working.map((r) => (
            <Row
              key={'w' + r.userId}
              dot="bg-green-500"
              name={r.name}
              subline={`${r.positionName || '—'}${r.locationName ? ' · ' + r.locationName : ''}`}
              right={r.scheduledEnd ? t('liveRoster.until', { time: fmtHM(r.scheduledEnd) }) : t('liveRoster.in', { time: fmtHM(r.clockIn) })}
              tone="green"
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ dot, name, subline, right, tone }: { dot: string; name: string; subline: string; right: string; tone: 'green' | 'amber' | 'red' }) {
  return (
    <li className={clsx(
      'flex items-center gap-3 px-4 py-2',
      tone === 'red' && 'bg-red-50/50 dark:bg-red-900/10'
    )}>
      <span className={clsx('h-2 w-2 rounded-full shrink-0', dot)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{name}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{subline}</div>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums shrink-0">{right}</div>
    </li>
  );
}
