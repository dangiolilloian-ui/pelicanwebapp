'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Location } from '@/types';

interface Sale {
  id: string;
  locationId: string;
  date: string;
  amount: number;
  notes: string | null;
}

// Manager-entered daily sales totals. Collapsed by default so it doesn't
// clutter the top of the reports page when nobody is looking at it.
export function DailySalesSection({ locations }: { locations: Location[] }) {
  const { token } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const load = async () => {
    if (!token || !open) return;
    setLoading(true);
    try {
      // Last 30 days
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const data = await api<Sale[]>(
        `/sales?start=${start.toISOString().slice(0, 10)}&end=${today}`,
        { token }
      );
      setSales(data);
    } catch (e: any) {
      setError(e.message || t('dailySales.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, token]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !locationId || !amount) return;
    setSaving(true);
    setError('');
    try {
      await api('/sales', {
        token,
        method: 'POST',
        body: JSON.stringify({
          locationId,
          date,
          amount: Number(amount),
          notes: notes.trim() || undefined,
        }),
      });
      setAmount('');
      setNotes('');
      await load();
    } catch (e: any) {
      setError(e.message || t('dailySales.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token) return;
    if (!confirm(t('dailySales.deleteConfirm'))) return;
    try {
      await api(`/sales/${id}`, { token, method: 'DELETE' });
      setSales((s) => s.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e.message || t('dailySales.deleteFailed'));
    }
  };

  const locName = (id: string) => locations.find((l) => l.id === id)?.name || t('common.unknown');
  const money = (v: number) =>
    v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('dailySales.title')}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('dailySales.desc')}
          </p>
        </div>
        <span className="text-gray-400 text-sm">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-800">
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <form onSubmit={save} className="flex flex-wrap gap-2 items-end mt-4">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('dailySales.date')}</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('dailySales.location')}</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('dailySales.amount')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t('dailySales.amountPlaceholder')}
                required
                className="w-32 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] font-medium text-gray-500 mb-1">{t('dailySales.notesOptional')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('dailySales.notesPlaceholder')}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </form>

          <div className="mt-5">
            <div className="text-[11px] font-semibold text-gray-500 uppercase mb-2">{t('dailySales.last30')}</div>
            {loading ? (
              <div className="py-4 text-center text-sm text-gray-400">{t('common.loading')}</div>
            ) : sales.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-400 italic">{t('dailySales.noEntries')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-gray-400">
                    <th className="py-1.5">{t('dailySales.date')}</th>
                    <th className="py-1.5">{t('dailySales.location')}</th>
                    <th className="py-1.5 text-right">{t('dailySales.amount')}</th>
                    <th className="py-1.5">{t('dailySales.notes')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sales.map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap">{s.date.slice(0, 10)}</td>
                      <td className="py-1.5 text-gray-700 dark:text-gray-300">{locName(s.locationId)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium text-gray-900 dark:text-gray-100">{money(s.amount)}</td>
                      <td className="py-1.5 text-xs text-gray-500 dark:text-gray-400">{s.notes || '—'}</td>
                      <td className="py-1.5 text-right">
                        <button onClick={() => remove(s.id)} className="text-xs text-red-600 hover:text-red-700">
                          {t('common.delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
