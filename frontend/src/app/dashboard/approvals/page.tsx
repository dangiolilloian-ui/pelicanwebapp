'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

// Mobile-first unified inbox for managers.  PTO requests + swap requests
// that need a decision, everything on one screen with thumb-sized actions.
// Dense desktop views live on /dashboard/timeoff and /dashboard/swaps —
// this page exists so a manager can clear the queue from their phone.

interface TimeoffRow {
  id: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  user: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

interface SwapRow {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  shift: {
    id: string;
    startTime: string;
    endTime: string;
    position: { id: string; name: string; color: string | null } | null;
    location: { id: string; name: string } | null;
  };
  requester: { id: string; firstName: string; lastName: string };
  target: { id: string; firstName: string; lastName: string } | null;
}

interface ApprovalsPayload {
  timeoff: TimeoffRow[];
  swaps: SwapRow[];
  counts: { timeoff: number; swaps: number; total: number };
}

type Tab = 'all' | 'timeoff' | 'swaps';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const fmtRange = (start: string, end: string) => {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${fmtDate(start)} · ${fmtTime(start)}–${fmtTime(end)}`
    : `${fmtDate(start)} – ${fmtDate(end)}`;
};

export default function ApprovalsPage() {
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';

  const [data, setData] = useState<ApprovalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [busy, setBusy] = useState<string | null>(null); // row id currently mutating
  const [flash, setFlash] = useState<string | null>(null);
  const t = useT();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await api<ApprovalsPayload>('/approvals', { token });
      setData(res);
    } catch (err) {
      console.error('Failed to load approvals', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const decideTimeoff = async (id: string, status: 'APPROVED' | 'DENIED') => {
    if (!token) return;
    setBusy(id);
    setFlash(null);
    try {
      await api(`/timeoff/${id}`, {
        token,
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      setFlash(`Time-off ${status.toLowerCase()}`);
      // Optimistically drop it from the list rather than refetching.
      setData((d) =>
        d
          ? {
              ...d,
              timeoff: d.timeoff.filter((r) => r.id !== id),
              counts: { ...d.counts, timeoff: d.counts.timeoff - 1, total: d.counts.total - 1 },
            }
          : d
      );
    } catch (err: any) {
      setFlash(err?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  const decideSwap = async (id: string, action: 'approve' | 'deny') => {
    if (!token) return;
    setBusy(id);
    setFlash(null);
    try {
      await api(`/swaps/${id}/${action}`, { token, method: 'POST', body: JSON.stringify({}) });
      setFlash(`Swap ${action === 'approve' ? 'approved' : 'denied'}`);
      setData((d) =>
        d
          ? {
              ...d,
              swaps: d.swaps.filter((r) => r.id !== id),
              counts: { ...d.counts, swaps: d.counts.swaps - 1, total: d.counts.total - 1 },
            }
          : d
      );
    } catch (err: any) {
      setFlash(err?.message || 'Failed');
    } finally {
      setBusy(null);
    }
  };

  if (!isManager) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600 dark:text-gray-400">{t('approvals.managerRequired')}</p>
      </div>
    );
  }

  const showTimeoff = tab === 'all' || tab === 'timeoff';
  const showSwaps = tab === 'all' || tab === 'swaps';
  const emptyAll =
    !loading && data && data.counts.total === 0;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('approvals.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {data
            ? data.counts.total === 0
              ? t('approvals.allCaughtUp')
              : t('approvals.itemsWaiting', { n: data.counts.total })
            : t('common.loading')}
        </p>
      </div>

      {/* Tab pills — sticky on mobile so they're always reachable */}
      <div className="sticky top-0 z-10 -mx-4 sm:mx-0 px-4 sm:px-0 py-2 bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 sm:border-0 sm:bg-transparent">
        <div className="flex gap-2">
          {(
            [
              { id: 'all', label: t('approvals.all'), count: data?.counts.total },
              { id: 'timeoff', label: t('approvals.timeOffTab'), count: data?.counts.timeoff },
              { id: 'swaps', label: t('approvals.swapsTab'), count: data?.counts.swaps },
            ] as const
          ).map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={clsx(
                'rounded-full px-3 py-1.5 text-sm font-medium transition',
                tab === tb.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-800'
              )}
            >
              {tb.label}
              {typeof tb.count === 'number' && tb.count > 0 && (
                <span
                  className={clsx(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                    tab === tb.id ? 'bg-white/25 text-white' : 'bg-indigo-100 text-indigo-700'
                  )}
                >
                  {tb.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {flash && (
        <div className="mt-3 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-200 text-sm px-3 py-2">
          {flash}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : emptyAll ? (
        <div className="mt-6 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{t('approvals.nothingWaiting')}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {showTimeoff &&
            data?.timeoff.map((r) => (
              <div
                key={r.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 text-[10px] font-mono font-medium px-2 py-0.5">
                        {t('approvals.timeOffBadge')}
                      </span>
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {r.user.firstName} {r.user.lastName}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1.5">
                      {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                      {r.hours ? ` · ${r.hours}h` : ''}
                    </p>
                    {r.reason && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic break-words">
                        "{r.reason}"
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => decideTimeoff(r.id, 'DENIED')}
                    disabled={busy === r.id}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    {t('common.deny')}
                  </button>
                  <button
                    onClick={() => decideTimeoff(r.id, 'APPROVED')}
                    disabled={busy === r.id}
                    className="rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {t('common.approve')}
                  </button>
                </div>
              </div>
            ))}

          {showSwaps &&
            data?.swaps.map((r) => (
              <div
                key={r.id}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 text-[10px] font-mono font-medium px-2 py-0.5">
                    {t('approvals.swapBadge')}
                  </span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {r.requester.firstName} {r.requester.lastName[0]}. →{' '}
                    {r.target ? `${r.target.firstName} ${r.target.lastName[0]}.` : t('approvals.open')}
                  </span>
                </div>
                <p className="text-sm text-gray-900 dark:text-gray-100 mt-1.5 font-medium">
                  {r.shift.position?.name || t('approvals.shift')}
                  {r.shift.location ? ` · ${r.shift.location.name}` : ''}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {fmtRange(r.shift.startTime, r.shift.endTime)}
                </p>
                {r.message && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 italic break-words">
                    "{r.message}"
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => decideSwap(r.id, 'deny')}
                    disabled={busy === r.id}
                    className="rounded-lg border border-gray-300 dark:border-gray-700 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    {t('common.deny')}
                  </button>
                  <button
                    onClick={() => decideSwap(r.id, 'approve')}
                    disabled={busy === r.id}
                    className="rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {t('common.approve')}
                  </button>
                </div>
              </div>
            ))}

          {/* Tab-specific empty states */}
          {showTimeoff && !showSwaps && data?.timeoff.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('approvals.noTimeOff')}
            </div>
          )}
          {showSwaps && !showTimeoff && data?.swaps.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('approvals.noSwaps')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
