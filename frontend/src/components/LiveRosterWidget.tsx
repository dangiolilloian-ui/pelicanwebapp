'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatShiftRange } from '@/lib/dates';
import clsx from 'clsx';

type AttendanceState = 'PRESENT' | 'LATE' | 'CALLOUT' | 'NO_SHOW';

interface Person {
  userId: string;
  name: string;
  shiftId: string;
  scheduledStart: string;
  scheduledEnd: string;
  state: AttendanceState;
}

interface PositionGroup {
  positionId: string | null;
  positionName: string;
  positionColor: string | null;
  people: Person[];
}

interface LocationGroup {
  locationId: string | null;
  locationName: string;
  positions: PositionGroup[];
}

interface Roster {
  generatedAt: string;
  locations: LocationGroup[];
}

// Manager-only live roster. Refreshes every 30s so it reflects recent
// attendance events without hammering the API. Location → position
// nesting; both collapsed by default.
export function LiveRosterWidget() {
  const t = useT();
  const { token } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState('');
  // Location IDs that are currently expanded. Collapsed by default.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await api<Roster>('/dashboard/live-roster', { token });
        if (alive) setRoster(data);
      } catch (e: unknown) {
        if (alive) setError((e as Error).message || 'Failed to load');
      }
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  const totals = useMemo(() => {
    if (!roster) return { present: 0, late: 0, out: 0, total: 0 };
    let present = 0;
    let late = 0;
    let out = 0;
    for (const loc of roster.locations) {
      for (const pos of loc.positions) {
        for (const p of pos.people) {
          if (p.state === 'LATE') late++;
          else if (p.state === 'CALLOUT' || p.state === 'NO_SHOW') out++;
          else present++;
        }
      }
    }
    return { present, late, out, total: present + late + out };
  }, [roster]);

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

  const fmtHM = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const toggleLocation = (locKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(locKey)) next.delete(locKey);
      else next.add(locKey);
      return next;
    });
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('liveRoster.title')}
          </h3>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('liveRoster.updated', { time: fmtHM(roster.generatedAt) })}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-green-500" /> {totals.present}
          </span>
          {totals.late > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-yellow-400" /> {totals.late}
            </span>
          )}
          {totals.out > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" /> {totals.out}
            </span>
          )}
        </div>
      </div>

      {roster.locations.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">{t('liveRoster.empty')}</div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {roster.locations.map((loc) => {
            const locKey = loc.locationId || '_none';
            const isOpen = expanded.has(locKey);
            const locCount = loc.positions.reduce((n, p) => n + p.people.length, 0);
            const locLate = loc.positions.reduce(
              (n, p) => n + p.people.filter((x) => x.state === 'LATE').length,
              0
            );
            const locOut = loc.positions.reduce(
              (n, p) =>
                n + p.people.filter((x) => x.state === 'CALLOUT' || x.state === 'NO_SHOW').length,
              0
            );
            return (
              <li key={locKey}>
                <button
                  onClick={() => toggleLocation(locKey)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
                >
                  <ChevronIcon open={isOpen} />
                  <span className="flex-1 text-left text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {loc.locationName}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                      {locCount - locLate - locOut}
                    </span>
                    {locLate > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                        {locLate}
                      </span>
                    )}
                    {locOut > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        {locOut}
                      </span>
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/20">
                    {loc.positions.map((pos) => {
                      const posKey = pos.positionId || '_none';
                      return (
                        <div key={posKey} className="py-1.5">
                          <div className="flex items-center gap-2 px-6 py-1">
                            {pos.positionColor && (
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: pos.positionColor }}
                              />
                            )}
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {pos.positionName}
                            </span>
                            <span className="text-[10px] text-gray-400">({pos.people.length})</span>
                          </div>
                          <ul>
                            {pos.people.map((person) => (
                              <PersonRow key={person.shiftId} person={person} t={t} />
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PersonRow({
  person,
  t,
}: {
  person: Person;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const dotClass =
    person.state === 'LATE'
      ? 'bg-yellow-400'
      : person.state === 'CALLOUT' || person.state === 'NO_SHOW'
      ? 'bg-red-500'
      : 'bg-green-500';

  const rowTint =
    person.state === 'CALLOUT' || person.state === 'NO_SHOW'
      ? 'bg-red-50/50 dark:bg-red-900/10'
      : person.state === 'LATE'
      ? 'bg-yellow-50/50 dark:bg-yellow-900/10'
      : '';

  const label =
    person.state === 'LATE'
      ? t('liveRoster.stateLate')
      : person.state === 'CALLOUT'
      ? t('liveRoster.stateCallout')
      : person.state === 'NO_SHOW'
      ? t('liveRoster.stateNoShow')
      : null;

  return (
    <li className={clsx('flex items-center gap-3 px-8 py-1.5', rowTint)}>
      <span className={clsx('h-2 w-2 rounded-full shrink-0', dotClass)} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{person.name}</div>
        {label && (
          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{label}</div>
        )}
      </div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
        {t('liveRoster.schedShort', {
          range: formatShiftRange(person.scheduledStart, person.scheduledEnd),
        })}
      </div>
    </li>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx('h-3.5 w-3.5 transition-transform text-gray-400', open && 'rotate-90')}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}
