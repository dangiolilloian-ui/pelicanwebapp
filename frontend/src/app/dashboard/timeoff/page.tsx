'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';
import { useT } from '@/lib/i18n';

interface TimeOffRequest {
  id: string;
  startDate: string;
  endDate: string;
  hours: number | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
  createdAt: string;
  user: { id: string; firstName: string; lastName: string };
}

interface PtoBalance {
  balance: number;
  ytdAccrued: number;
  annualCap: number;
  remainingAccrualHeadroom: number;
  enabled: boolean;
}

export default function TimeOffPage() {
  const { token, user } = useAuth();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [filter, setFilter] = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '', hours: '', reason: '' });
  const [balance, setBalance] = useState<PtoBalance | null>(null);
  const [actionError, setActionError] = useState('');
  const [formError, setFormError] = useState('');
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const t = useT();

  const fetch = useCallback(async () => {
    if (!token) return;
    const [data, bal] = await Promise.all([
      api<TimeOffRequest[]>('/timeoff', { token }),
      api<PtoBalance>('/pto/balance', { token }).catch(() => null),
    ]);
    setRequests(data);
    setBalance(bal);
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setFormError('');
    try {
      await api('/timeoff', {
        token,
        method: 'POST',
        body: JSON.stringify({
          startDate: form.startDate,
          endDate: form.endDate,
          hours: form.hours ? Number(form.hours) : null,
          reason: form.reason,
        }),
      });
      setShowForm(false);
      setForm({ startDate: '', endDate: '', hours: '', reason: '' });
      fetch();
    } catch (err: any) {
      setFormError(err.message || 'Failed to submit request');
    }
  };

  const handleAction = async (id: string, status: string) => {
    if (!token) return;
    setActionError('');
    try {
      await api(`/timeoff/${id}`, { token, method: 'PUT', body: JSON.stringify({ status }) });
      fetch();
    } catch (err: any) {
      setActionError(err.message || 'Failed to update request');
    }
  };

  const filtered = filter === 'ALL' ? requests : requests.filter((r) => r.status === filter);

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      PENDING: 'bg-amber-100 text-amber-700',
      APPROVED: 'bg-green-100 text-green-700',
      DENIED: 'bg-red-100 text-red-700',
    };
    return (
      <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', styles[status])}>
        {status}
      </span>
    );
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('timeoff.title')}</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
        >
          {showForm ? t('common.cancel') : t('timeoff.newRequest')}
        </button>
      </div>

      {balance && balance.enabled && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('timeoff.ptoBalance')}</p>
            <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
              {balance.balance.toFixed(2)}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">{t('common.hours')}</span>
            </p>
          </div>
          <div className="text-right text-xs text-gray-500 dark:text-gray-400">
            <p>{t('timeoff.ytdAccrued')} <span className="font-medium text-gray-700 dark:text-gray-300">{balance.ytdAccrued.toFixed(2)}h</span></p>
            <p>{t('timeoff.annualCap', { cap: balance.annualCap, headroom: balance.remainingAccrualHeadroom.toFixed(2) })}</p>
          </div>
        </div>
      )}

      {actionError && (
        <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2 mb-4">{actionError}</p>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6 space-y-3">
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{formError}</p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('timeoff.startDate')}</label>
              <input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('timeoff.endDate')}</label>
              <input type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('timeoff.ptoHours')}</label>
              <input type="number" min="0" step="0.5" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}
                placeholder={t('timeoff.ptoHoursPlaceholder')} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              {balance && balance.enabled && (
                <p className="text-[10px] text-gray-500 mt-1">
                  {t('timeoff.balanceHint', { n: balance.balance.toFixed(2) })}
                </p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('timeoff.reason')}</label>
            <input type="text" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={t('timeoff.reasonPlaceholder')} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition">
            {t('timeoff.submitRequest')}
          </button>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        {(['ALL', 'PENDING', 'APPROVED', 'DENIED'] as const).map((f) => {
          const filterLabels: Record<string, string> = { ALL: t('timeoff.all'), PENDING: t('timeoff.pending'), APPROVED: t('timeoff.approved'), DENIED: t('timeoff.denied') };
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={clsx('rounded-lg px-3 py-1.5 text-sm font-medium transition',
                filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200')}>
              {filterLabels[f]}
              {f !== 'ALL' && <span className="ml-1 opacity-60">({requests.filter((r) => r.status === f).length})</span>}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">{t('timeoff.noRequests')}</div>
        )}
        {filtered.map((req) => (
          <div key={req.id} className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-medium text-indigo-700">
                {req.user.firstName[0]}{req.user.lastName[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {req.user.firstName} {req.user.lastName}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(req.startDate)} — {formatDate(req.endDate)}
                  {req.hours != null && <span className="ml-2 text-gray-400">· {t('timeoff.ptoBadge', { n: req.hours })}</span>}
                  {req.reason && <span className="ml-2 text-gray-400">· {req.reason}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {statusBadge(req.status)}
              {isManager && req.status === 'PENDING' && (
                <>
                  <button onClick={() => handleAction(req.id, 'APPROVED')}
                    className="rounded-lg bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition">
                    {t('common.approve')}
                  </button>
                  <button onClick={() => handleAction(req.id, 'DENIED')}
                    className="rounded-lg bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 transition">
                    {t('common.deny')}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
