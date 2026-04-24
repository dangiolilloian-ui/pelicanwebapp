'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { formatShiftRange } from '@/lib/dates';
import clsx from 'clsx';

// Full state for manager-level rows; simplified rows only use the
// CHECKED_IN / NOT_CHECKED_IN values.
type AttendanceState =
  | 'NOT_CHECKED_IN'
  | 'CHECKED_IN'
  | 'LATE'
  | 'CALLOUT'
  | 'NO_SHOW';

interface Events {
  checkedIn: string | null;
  late: string | null;
  callout: string | null;
  noShow: string | null;
}

interface Person {
  userId: string;
  name: string;
  shiftId: string;
  scheduledStart: string;
  scheduledEnd: string;
  state: AttendanceState;
  canManage: boolean;
  events: Events | null;
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
  viewerRole: 'OWNER' | 'ADMIN' | 'MANAGER' | 'EMPLOYEE';
  locations: LocationGroup[];
}

// Live roster widget — see backend GET /dashboard/live-roster for the
// full role-based scope and privacy rules. Refreshes every 30s so
// attendance events surface quickly without hammering the API. For rows
// the viewer can manage, the dot is clickable (toggles CHECKED_IN) and
// extra "Late" / "Out" buttons are shown.
export function LiveRosterWidget() {
  const t = useT();
  const { token } = useAuth();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyShift, setBusyShift] = useState<string | null>(null);

  const load = useMemo(
    () => async (signal?: AbortSignal) => {
      try {
        const data = await api<Roster>('/dashboard/live-roster', { token, signal });
        if (!signal?.aborted) setRoster(data);
      } catch (e: unknown) {
        if (!signal?.aborted) setError((e as Error).message || 'Failed to load');
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    load(ctrl.signal);
    const id = setInterval(() => load(ctrl.signal), 30000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [token, load]);

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
          else if (p.state === 'CHECKED_IN') present++;
        }
      }
    }
    return { present, late, out, total: present + late + out };
  }, [roster]);

  // Toggle a given attendance event type on a shift. If the event
  // already exists, DELETE it; otherwise POST a new one. Refreshes
  // the roster after the change so dot colors + action state update.
  const toggleEvent = async (
    person: Person,
    eventType: 'CHECKED_IN' | 'LATE' | 'CALLOUT'
  ) => {
    if (!person.canManage || !person.events) return;
    const existingId =
      eventType === 'CHECKED_IN'
        ? person.events.checkedIn
        : eventType === 'LATE'
        ? person.events.late
        : person.events.callout;

    setBusyShift(person.shiftId);
    try {
      if (existingId) {
        await api(`/attendance/${existingId}`, {
          method: 'DELETE',
          token,
        });
      } else {
        await api(`/attendance/shift/${person.shiftId}`, {
          method: 'POST',
          token,
          body: JSON.stringify({ type: eventType }),
        });
      }
      await load();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed');
    } finally {
      setBusyShift(null);
    }
  };

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

  const showDetailedTotals = roster.viewerRole !== 'EMPLOYEE';

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
          {showDetailedTotals && totals.late > 0 && (
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-yellow-400" /> {totals.late}
            </span>
          )}
          {showDetailedTotals && totals.out > 0 && (
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
            const locHere = loc.positions.reduce(
              (n, p) => n + p.people.filter((x) => x.state === 'CHECKED_IN').length,
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
                      {locHere}
                      {showDetailedTotals && (
                        <span className="text-gray-400">/{locCount}</span>
                      )}
                    </span>
                    {showDetailedTotals && locLate > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                        {locLate}
                      </span>
                    )}
                    {showDetailedTotals && locOut > 0 && (
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
                              <PersonRow
                                key={person.shiftId}
                                person={person}
                                busy={busyShift === person.shiftId}
                                onToggle={toggleEvent}
                                t={t}
                              />
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
  busy,
  onToggle,
  t,
}: {
  person: Person;
  busy: boolean;
  onToggle: (p: Person, type: 'CHECKED_IN' | 'LATE' | 'CALLOUT') => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const dotClass =
    person.state === 'CALLOUT' || person.state === 'NO_SHOW'
      ? 'bg-red-500'
      : person.state === 'LATE'
      ? 'bg-yellow-400'
      : person.state === 'CHECKED_IN'
      ? 'bg-green-500'
      : 'bg-gray-300 dark:bg-gray-600';

  const rowTint =
    person.state === 'CALLOUT' || person.state === 'NO_SHOW'
      ? 'bg-red-50/50 dark:bg-red-900/10'
      : person.state === 'LATE'
      ? 'bg-yellow-50/50 dark:bg-yellow-900/10'
      : '';

  const stateLabel =
    person.state === 'CALLOUT'
      ? t('liveRoster.stateCallout')
      : person.state === 'NO_SHOW'
      ? t('liveRoster.stateNoShow')
      : person.state === 'LATE'
      ? t('liveRoster.stateLate')
      : person.state === 'CHECKED_IN'
      ? t('liveRoster.stateCheckedIn')
      : t('liveRoster.stateNotCheckedIn');

  // Dot is a button only when the viewer can manage this row. We still
  // use a <button> tag so keyboard users can activate it; for read-only
  // rows it's a plain span.
  const Dot = person.canManage ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(person, 'CHECKED_IN')}
      title={
        person.events?.checkedIn
          ? t('liveRoster.undoCheckIn')
          : t('liveRoster.markCheckedIn')
      }
      className={clsx(
        'h-3 w-3 rounded-full shrink-0 ring-2 ring-transparent hover:ring-gray-300 dark:hover:ring-gray-600 transition',
        dotClass,
        busy && 'opacity-50'
      )}
    />
  ) : (
    <span className={clsx('h-2 w-2 rounded-full shrink-0', dotClass)} />
  );

  return (
    <li className={clsx('flex items-center gap-3 px-8 py-1.5', rowTint)}>
      {Dot}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{person.name}</div>
        <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{stateLabel}</div>
      </div>
      {person.canManage && (
        <div className="flex items-center gap-1 shrink-0">
          <ActionButton
            active={!!person.events?.late}
            disabled={busy}
            onClick={() => onToggle(person, 'LATE')}
            tone="yellow"
          >
            {t('liveRoster.late')}
          </ActionButton>
          <ActionButton
            active={!!person.events?.callout}
            disabled={busy}
            onClick={() => onToggle(person, 'CALLOUT')}
            tone="red"
          >
            {t('liveRoster.out')}
          </ActionButton>
        </div>
      )}
      <div className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
        {t('liveRoster.schedShort', {
          range: formatShiftRange(person.scheduledStart, person.scheduledEnd),
        })}
      </div>
    </li>
  );
}

function ActionButton({
  active,
  disabled,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  tone: 'yellow' | 'red';
  children: React.ReactNode;
}) {
  const palette =
    tone === 'yellow'
      ? active
        ? 'bg-yellow-400 text-white border-yellow-400'
        : 'bg-white dark:bg-gray-900 text-yellow-700 dark:text-yellow-400 border-gray-200 dark:border-gray-700 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
      : active
      ? 'bg-red-500 text-white border-red-500'
      : 'bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 border-gray-200 dark:border-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border transition',
        palette,
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {children}
    </button>
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
