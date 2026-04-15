'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface TimeEntry {
  id: string;
  userId: string;
  shiftId: string | null;
  clockIn: string;
  clockOut: string | null;
  breakStartedAt: string | null;
  totalBreakMinutes: number;
  notes: string | null;
  user?: { id: string; firstName: string; lastName: string };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const s = Math.floor((ms % 60000) / 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function TimeClockPage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const [active, setActive] = useState<TimeEntry | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffNote, setHandoffNote] = useState('');

  const reload = async () => {
    if (!token) return;
    try {
      const [act, list] = await Promise.all([
        api<TimeEntry | null>('/timeclock/active', { token }),
        api<TimeEntry[]>('/timeclock', { token }),
      ]);
      setActive(act);
      setEntries(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Live ticker for active entry
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  const getCoords = (): Promise<{ latitude: number; longitude: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });

  const clockIn = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const coords = await getCoords();
      await api('/timeclock/clock-in', {
        token,
        method: 'POST',
        body: JSON.stringify(coords || {}),
      });
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Two-step clock-out: if the active entry is linked to a scheduled shift,
  // open the handoff composer first so the opener tomorrow has context.
  // Unlinked entries (ad-hoc clock-ins) skip it.
  const requestClockOut = () => {
    if (!active) return;
    if (active.shiftId) {
      setHandoffNote('');
      setHandoffOpen(true);
    } else {
      doClockOut(null);
    }
  };

  const doClockOut = async (note: string | null) => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await api('/timeclock/clock-out', {
        token,
        method: 'POST',
        body: JSON.stringify(note ? { handoffNote: note } : {}),
      });
      setHandoffOpen(false);
      setHandoffNote('');
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const startBreak = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await api('/timeclock/break/start', { token, method: 'POST' });
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const endBreak = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await api('/timeclock/break/end', { token, method: 'POST' });
      await reload();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Total elapsed minus break minutes (break minutes includes the live-running break if any)
  const onBreakMs = active?.breakStartedAt ? now - new Date(active.breakStartedAt).getTime() : 0;
  const totalBreakMs = active ? active.totalBreakMinutes * 60000 + onBreakMs : 0;
  const rawElapsed = active ? now - new Date(active.clockIn).getTime() : 0;
  const elapsed = Math.max(0, rawElapsed - totalBreakMs);

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">{t('timeclock.title')}</h1>

      {/* Big clock panel */}
      <div
        className={clsx(
          'rounded-2xl p-8 text-center transition mb-6',
          active
            ? 'bg-gradient-to-br from-green-500 to-emerald-600 text-white'
            : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800'
        )}
      >
        {loading ? (
          <div className="h-20 flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        ) : active ? (
          <>
            <p className="text-sm uppercase tracking-wider opacity-80 mb-2">
              {active.breakStartedAt ? t('timeclock.onBreak') : t('timeclock.onTheClock')}
            </p>
            <p className="text-5xl font-mono font-bold tabular-nums">{formatDuration(elapsed)}</p>
            <p className="text-xs opacity-80 mt-2">
              {t('timeclock.startedAt', { time: new Date(active.clockIn).toLocaleTimeString() })}
              {totalBreakMs > 0 && (
                <> · {t('timeclock.minOnBreak', { n: Math.floor(totalBreakMs / 60000) })}</>
              )}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={requestClockOut}
                disabled={busy || !!active.breakStartedAt}
                title={active.breakStartedAt ? t('timeclock.endBreakFirst') : undefined}
                className="rounded-xl bg-white dark:bg-gray-900 text-green-700 px-8 py-3 font-semibold text-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition"
              >
                {busy ? t('timeclock.clockingOut') : t('today.clockOut')}
              </button>
              {active.breakStartedAt ? (
                <button
                  onClick={endBreak}
                  disabled={busy}
                  className="rounded-xl bg-amber-400 text-amber-900 px-6 py-3 font-semibold hover:bg-amber-300 disabled:opacity-50 transition"
                >
                  {t('timeclock.endBreak')}
                </button>
              ) : (
                <button
                  onClick={startBreak}
                  disabled={busy}
                  className="rounded-xl border border-white/40 text-white px-6 py-3 font-semibold hover:bg-white/10 disabled:opacity-50 transition"
                >
                  {t('timeclock.startBreak')}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">{t('timeclock.notClockedIn')}</p>
            <p className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <button
              onClick={clockIn}
              disabled={busy}
              className="mt-6 rounded-xl bg-indigo-600 text-white px-8 py-3 font-semibold text-lg hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {busy ? t('timeclock.clockingIn') : t('today.clockIn')}
            </button>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-100 bg-red-600/30 rounded p-2 inline-block">{error}</p>}
      </div>

      {/* Handoff composer */}
      {handoffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('timeclock.handoffTitle')}</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('timeclock.handoffDesc')}
            </p>
            <textarea
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder={t('timeclock.handoffPlaceholder')}
              className="mt-3 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => doClockOut(null)}
                disabled={busy}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {t('timeclock.skipClockOut')}
              </button>
              <button
                onClick={() => doClockOut(handoffNote.trim() || null)}
                disabled={busy}
                className="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? t('common.saving') : t('timeclock.saveClockOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent entries */}
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-3">
        {isManager ? t('timeclock.allEntries') : t('timeclock.yourEntries')}
      </h2>
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">{t('timeclock.noEntries')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs uppercase">
              <tr>
                {isManager && <th className="px-4 py-2 text-left">{t('timeclock.employee')}</th>}
                <th className="px-4 py-2 text-left">{t('today.clockIn')}</th>
                <th className="px-4 py-2 text-left">{t('today.clockOut')}</th>
                <th className="px-4 py-2 text-right">{t('timeclock.duration')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {entries.map((e) => {
                const dur = e.clockOut
                  ? new Date(e.clockOut).getTime() - new Date(e.clockIn).getTime() - e.totalBreakMinutes * 60000
                  : null;
                return (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    {isManager && (
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                        {e.user ? `${e.user.firstName} ${e.user.lastName}` : '—'}
                      </td>
                    )}
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                      {new Date(e.clockIn).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                      {e.clockOut
                        ? new Date(e.clockOut).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : <span className="text-green-600 font-medium">{t('timeclock.active')}</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {dur !== null ? `${(dur / 3600000).toFixed(2)}h` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
