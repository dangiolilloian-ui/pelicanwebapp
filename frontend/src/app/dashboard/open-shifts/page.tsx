'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface OpenShiftClaim {
  id: string;
  userId: string;
  user: { firstName: string; lastName: string };
}

interface OpenShift {
  id: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  position: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
  claims: OpenShiftClaim[];
}

function fmtRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const date = s.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const t1 = s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const t2 = e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${t1} – ${t2}`;
}

function hoursBetween(start: string, end: string) {
  return ((new Date(end).getTime() - new Date(start).getTime()) / 3600000).toFixed(1);
}

export default function OpenShiftsPage() {
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const t = useT();
  const [shifts, setShifts] = useState<OpenShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<OpenShift[]>('/shifts/open', { token });
      setShifts(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(''), 2500);
  };

  const claimShift = async (shiftId: string) => {
    setBusyId(shiftId);
    setError('');
    try {
      await api(`/shifts/${shiftId}/claim`, { token, method: 'POST' });
      showFlash(t('openShifts.requestSent'));
      await reload();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const cancelClaim = async (claimId: string) => {
    setBusyId(claimId);
    try {
      await api(`/shifts/claims/${claimId}/cancel`, { token, method: 'POST' });
      await reload();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const approveClaim = async (claimId: string) => {
    setBusyId(claimId);
    try {
      await api(`/shifts/claims/${claimId}/approve`, { token, method: 'POST' });
      showFlash(t('openShifts.claimApproved'));
      await reload();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  const denyClaim = async (claimId: string) => {
    setBusyId(claimId);
    try {
      await api(`/shifts/claims/${claimId}/deny`, { token, method: 'POST' });
      await reload();
    } catch (e: any) {
      setError(e.message || 'Failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('openShifts.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {isManager
            ? t('openShifts.managerDesc')
            : t('openShifts.employeeDesc')}
        </p>
      </div>

      {flash && (
        <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-2 text-sm text-green-700 dark:text-green-300">
          {flash}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('openShifts.noOpenShifts')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shifts.map((s) => {
            const myClaim = s.claims.find((c) => c.userId === user?.id);
            return (
              <div
                key={s.id}
                className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="h-10 w-1 rounded-full shrink-0"
                      style={{ backgroundColor: s.position?.color || '#6366f1' }}
                    />
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {fmtRange(s.startTime, s.endTime)}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {s.position?.name || t('openShifts.anyPosition')}
                        {s.location && <> · {s.location.name}</>}
                        {' · '}{hoursBetween(s.startTime, s.endTime)}h
                      </p>
                      {s.notes && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">
                          {s.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  {!isManager && (
                    myClaim ? (
                      <button
                        onClick={() => cancelClaim(myClaim.id)}
                        disabled={busyId === myClaim.id}
                        className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        {t('openShifts.cancelRequest')}
                      </button>
                    ) : (
                      <button
                        onClick={() => claimShift(s.id)}
                        disabled={busyId === s.id}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyId === s.id ? t('openShifts.requesting') : t('openShifts.requestShift')}
                      </button>
                    )
                  )}
                </div>

                {/* Claims list */}
                {s.claims.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                      {t('openShifts.pendingRequests', { n: s.claims.length })}
                    </p>
                    <div className="space-y-1.5">
                      {s.claims.map((c) => (
                        <div
                          key={c.id}
                          className={clsx(
                            'flex items-center justify-between rounded-lg px-3 py-1.5 text-xs',
                            c.userId === user?.id
                              ? 'bg-indigo-50 dark:bg-indigo-900/20'
                              : 'bg-gray-50 dark:bg-gray-800/50'
                          )}
                        >
                          <span className="text-gray-700 dark:text-gray-300">
                            {c.user.firstName} {c.user.lastName}
                            {c.userId === user?.id && <span className="ml-1 text-indigo-600 dark:text-indigo-400">{t('openShifts.you')}</span>}
                          </span>
                          {isManager && (
                            <div className="flex gap-2">
                              <button
                                onClick={() => approveClaim(c.id)}
                                disabled={busyId === c.id}
                                className="rounded bg-green-600 px-2 py-0.5 text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                {t('common.approve')}
                              </button>
                              <button
                                onClick={() => denyClaim(c.id)}
                                disabled={busyId === c.id}
                                className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-0.5 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                              >
                                {t('common.deny')}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
