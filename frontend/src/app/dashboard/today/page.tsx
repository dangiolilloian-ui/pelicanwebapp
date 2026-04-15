'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Shift } from '@/types';
import clsx from 'clsx';

// "My Day" — mobile-first employee landing screen.  Collapses all of the
// information a front-line worker actually needs at shift start into one
// scrollable column: next shift + countdown, clock-in/out button, PTO balance,
// unread messages, pinned announcements, and the rest of the week as a tight
// list.  Intentionally does not show any of the manager tooling — keeps the
// cognitive load low for the 80% of users who never open the schedule grid.

interface TimeEntry {
  id: string;
  clockIn: string;
  clockOut: string | null;
}

interface PtoBalance {
  balance: number;
  enabled: boolean;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { firstName: string; lastName: string } | null;
}

interface PrevHandoff {
  shiftId: string;
  note: string;
  author: string | null;
  endTime: string;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function humanizeCountdown(ms: number, t: (k: string, v?: any) => string) {
  if (ms <= 0) return t('today.onShift');
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return t('today.startsIn', { time: `${totalMin} min` });
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const timePart = m === 0 ? `${h}h` : `${h}h ${m}m`;
  return t('today.startsIn', { time: timePart });
}

export default function TodayPage() {
  const { token, user } = useAuth();
  const t = useT();

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [pto, setPto] = useState<PtoBalance | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [prevHandoff, setPrevHandoff] = useState<PrevHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Re-render every 30 s so the countdown ticks without us having to worry
  // about sub-minute precision.  Cheaper than a 1 s interval and still feels
  // responsive for start-of-shift checks.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!token || !user) return;
    // Fetch a week-wide window so "upcoming this week" is trivially derivable.
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    const qs = `start=${start.toISOString()}&end=${end.toISOString()}`;

    const [allShifts, act, bal, unread, anns] = await Promise.all([
      api<Shift[]>(`/shifts?${qs}`, { token }),
      api<TimeEntry | null>('/timeclock/active', { token }),
      api<PtoBalance>('/pto/balance', { token }).catch(() => ({ balance: 0, enabled: false })),
      api<{ count: number }>('/notifications/unread-count', { token }).catch(() => ({ count: 0 })),
      api<Announcement[]>('/announcements', { token }).catch(() => []),
    ]);

    setShifts(
      allShifts
        .filter((s) => s.user?.id === user.id && s.status === 'PUBLISHED')
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
    );
    setActive(act);
    setPto(bal as PtoBalance);
    setUnreadCount(unread.count);
    setAnnouncements(anns.filter((a) => a.pinned).slice(0, 3));
  }, [token, user]);

  useEffect(() => {
    load();
  }, [load]);

  // Walk-in handoff: once we know the next shift, ask the backend for the
  // last handoff note at the same location.  Skip if there is no next shift
  // (no point) or we're already past it (handoff only matters on arrival).
  const nextShiftId = shifts.find((s) => new Date(s.endTime).getTime() > now.getTime())?.id;
  useEffect(() => {
    if (!token || !nextShiftId) {
      setPrevHandoff(null);
      return;
    }
    let cancelled = false;
    api<{ handoff: PrevHandoff | null }>(`/shifts/${nextShiftId}/previous-handoff`, { token })
      .then((r) => {
        if (!cancelled) setPrevHandoff(r.handoff);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, nextShiftId]);

  const onClockIn = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api('/timeclock/clock-in', { token, method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (err: any) {
      alert(err.message || 'Clock-in failed');
    } finally {
      setBusy(false);
    }
  };

  const onClockOut = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api('/timeclock/clock-out', { token, method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (err: any) {
      alert(err.message || 'Clock-out failed');
    } finally {
      setBusy(false);
    }
  };

  // Split shifts into "next" (the closest future or currently-happening one)
  // and the rest.  We keep "currently happening" in `next` so the big card
  // covers both cases — an employee who just started their shift sees the
  // same card they saw two hours ago, just with the countdown showing "on
  // shift" and the clock-out button primed.
  const nextShift = shifts.find((s) => new Date(s.endTime).getTime() > now.getTime());
  const laterShifts = shifts.filter((s) => s.id !== nextShift?.id).slice(0, 7);

  const nextStartMs = nextShift ? new Date(nextShift.startTime).getTime() - now.getTime() : 0;
  const nextIsActive = nextShift && new Date(nextShift.startTime).getTime() <= now.getTime();

  return (
    <div className="mx-auto max-w-md px-4 py-4 sm:py-6 space-y-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          {t('today.title')}
        </h1>
      </header>

      {/* Primary card: next shift + clock action.  This is the only thing
          many users will look at all day. */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 shadow-sm">
        <p className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
          {t('today.nextShift')}
        </p>
        {nextShift ? (
          <>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {fmtDate(nextShift.startTime)}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 tabular-nums">
                  {fmtTime(nextShift.startTime)} – {fmtTime(nextShift.endTime)}
                </p>
              </div>
              <span
                className={clsx(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  nextIsActive
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                )}
              >
                {humanizeCountdown(nextStartMs, t)}
              </span>
            </div>
            {nextShift.location && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {nextShift.location.name}
                {nextShift.position && ` · ${nextShift.position.name}`}
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('today.noShifts')}</p>
        )}

        <div className="mt-4">
          {active ? (
            <button
              onClick={onClockOut}
              disabled={busy}
              className="w-full rounded-xl bg-red-600 py-3 text-base font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition"
            >
              {t('today.clockOut')}
            </button>
          ) : (
            <button
              onClick={onClockIn}
              disabled={busy || !nextShift}
              className="w-full rounded-xl bg-green-600 py-3 text-base font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition"
            >
              {t('today.clockIn')}
            </button>
          )}
        </div>
      </section>

      {/* Handoff from the previous shift at this location — what the closer
          left behind.  Rendered right after the primary card so it's the
          second thing an arriving opener sees. */}
      {prevHandoff && (
        <section className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-200">
            {t('today.fromLastShift')}
          </p>
          <p className="mt-1.5 text-sm text-blue-900 dark:text-blue-100 whitespace-pre-wrap break-words">
            {prevHandoff.note}
          </p>
          {prevHandoff.author && (
            <p className="mt-2 text-[11px] text-blue-700/80 dark:text-blue-300/80">
              — {prevHandoff.author}, {fmtTime(prevHandoff.endTime)}
            </p>
          )}
        </section>
      )}

      {/* Quick-glance tiles: PTO balance + unread messages.  Grid on a single
          row since most phones are narrow enough that two small tiles beat one
          stacked column for scan-ability. */}
      <div className="grid grid-cols-2 gap-3">
        {pto?.enabled && (
          <a
            href="/dashboard/timeoff"
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t('today.pto')}
            </p>
            <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {pto.balance.toFixed(1)}
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-0.5">h</span>
            </p>
          </a>
        )}
        <a
          href="/dashboard/messages"
          className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
        >
          <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('today.messages')}
          </p>
          <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
            {unreadCount}
          </p>
        </a>
      </div>

      {/* Pinned announcements — only render if there are any so we don't
          waste precious viewport on an empty card. */}
      {announcements.length > 0 && (
        <section className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            {t('today.announcements')}
          </p>
          <ul className="mt-2 space-y-2">
            {announcements.map((a) => (
              <li key={a.id}>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{a.title}</p>
                <p className="text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap">
                  {a.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Rest of the week as a lean list.  We hit the schedule grid for
          anything more detailed, so no position/location clutter here. */}
      {laterShifts.length > 0 && (
        <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
            {t('today.upcoming')}
          </p>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {laterShifts.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-gray-900 dark:text-gray-100">{fmtDate(s.startTime)}</span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {fmtTime(s.startTime)}–{fmtTime(s.endTime)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
