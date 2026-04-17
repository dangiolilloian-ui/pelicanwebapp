'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useShifts } from '@/hooks/useShifts';
import { getWeekStart, addDays, formatDate, formatTime } from '@/lib/dates';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface Swap {
  id: string;
  status: 'PENDING' | 'ACCEPTED' | 'APPROVED' | 'DENIED' | 'CANCELLED';
  message: string | null;
  createdAt: string;
  shift: {
    id: string;
    startTime: string;
    endTime: string;
    user: { id: string; firstName: string; lastName: string } | null;
    position: { id: string; name: string; color: string } | null;
    location: { id: string; name: string } | null;
  };
  requester: { id: string; firstName: string; lastName: string };
  target: { id: string; firstName: string; lastName: string } | null;
}

const statusStyles: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  ACCEPTED: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  DENIED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

export default function SwapsPage() {
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const t = useT();
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [message, setMessage] = useState('');

  const weekStart = getWeekStart(new Date());
  const { shifts } = useShifts(weekStart, addDays(weekStart, 14));
  const myShifts = shifts.filter((s) => s.user?.id === user?.id && s.status === 'PUBLISHED');

  const reload = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api<Swap[]>('/swaps', { token });
      setSwaps(data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { reload(); }, [reload]);

  const createSwap = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedShiftId) return;
    await api('/swaps', {
      token, method: 'POST',
      body: JSON.stringify({ shiftId: selectedShiftId, message: message || undefined }),
    });
    setShowForm(false);
    setSelectedShiftId('');
    setMessage('');
    reload();
  };

  const action = async (id: string, path: string) => {
    if (!token) return;
    await api(`/swaps/${id}/${path}`, { token, method: 'POST' });
    reload();
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('swaps.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t('swaps.desc')}
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
        >
          {showForm ? t('common.cancel') : t('swaps.newSwap')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={createSwap} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('swaps.pickShift')}</label>
            <select
              required value={selectedShiftId}
              onChange={(e) => setSelectedShiftId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm bg-white dark:bg-gray-900"
            >
              <option value="">{t('swaps.selectPlaceholder')}</option>
              {myShifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDate(new Date(s.startTime))} · {formatTime(s.startTime)}–{formatTime(s.endTime)}
                  {s.position ? ` · ${s.position.name}` : ''}
                </option>
              ))}
            </select>
            {myShifts.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">{t('swaps.noShiftsAvailable')}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('swaps.messageLabel')}</label>
            <textarea
              value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
              placeholder={t('swaps.messagePlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm bg-white dark:bg-gray-900"
            />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            {t('swaps.postSwap')}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : swaps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center text-gray-400">
          {t('swaps.noSwaps')}
        </div>
      ) : (
        <div className="space-y-3">
          {swaps.map((sw) => {
            const shiftDate = new Date(sw.shift.startTime);
            const isMine = sw.requester.id === user?.id;
            const canAccept =
              sw.status === 'PENDING' &&
              !isMine &&
              user?.role === 'EMPLOYEE' &&
              (sw.target?.id === user?.id || !sw.target);
            const canApprove = isManager && sw.status === 'ACCEPTED';

            return (
              <div key={sw.id} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={clsx('text-[10px] font-medium rounded-full px-2 py-0.5 uppercase', statusStyles[sw.status])}>
                        {sw.status}
                      </span>
                      {sw.shift.position && (
                        <span className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sw.shift.position.color }} />
                          {sw.shift.position.name}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {formatDate(shiftDate)} · {formatTime(sw.shift.startTime)}–{formatTime(sw.shift.endTime)}
                      {sw.shift.location ? ` · ${sw.shift.location.name}` : ''}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('swaps.proposedBy', { name: `${sw.requester.firstName} ${sw.requester.lastName}` })}
                      {sw.target ? ` → ${sw.target.firstName} ${sw.target.lastName}` : ` · ${t('swaps.openToAnyone')}`}
                    </p>
                    {sw.message && (
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-2 italic">&ldquo;{sw.message}&rdquo;</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {canAccept && (
                      <button onClick={() => action(sw.id, 'accept')} className="text-xs rounded bg-blue-600 text-white px-3 py-1 hover:bg-blue-700">
                        {t('swaps.accept')}
                      </button>
                    )}
                    {canApprove && (
                      <>
                        <button onClick={() => action(sw.id, 'approve')} className="text-xs rounded bg-green-600 text-white px-3 py-1 hover:bg-green-700">
                          {t('common.approve')}
                        </button>
                        <button onClick={() => action(sw.id, 'deny')} className="text-xs rounded bg-red-600 text-white px-3 py-1 hover:bg-red-700">
                          {t('common.deny')}
                        </button>
                      </>
                    )}
                    {isMine && (sw.status === 'PENDING' || sw.status === 'ACCEPTED') && (
                      <button onClick={() => action(sw.id, 'cancel')} className="text-xs rounded border border-gray-300 dark:border-gray-700 px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-800">
                        {t('common.cancel')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
