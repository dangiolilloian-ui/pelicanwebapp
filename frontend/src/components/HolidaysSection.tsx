'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Holiday {
  id: string;
  date: string;
  name: string;
}

// Holidays block scheduling on these dates. Managers add entries here;
// the schedule view and backend enforce the block.
export function HolidaysSection() {
  const t = useT();
  const { token, user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api<Holiday[]>(`/holidays?year=${year}`, { token });
      setHolidays(data);
    } catch (e: any) {
      setError(e.message || t('holidays.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token, year]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !date || !name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api('/holidays', {
        token,
        method: 'POST',
        body: JSON.stringify({ date, name: name.trim() }),
      });
      setDate('');
      setName('');
      await load();
    } catch (e: any) {
      setError(e.message || t('holidays.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token) return;
    if (!confirm(t('holidays.removeConfirm'))) return;
    try {
      await api(`/holidays/${id}`, { token, method: 'DELETE' });
      setHolidays((h) => h.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e.message || t('holidays.deleteFailed'));
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso.slice(0, 10) + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const years = [year - 1, year, year + 1];

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('holidays.title')}</h2>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Scheduling is blocked on these dates. No one can be assigned a shift on a holiday.
      </p>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-6 flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        </div>
      ) : holidays.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic py-2">{t('holidays.noHolidays', { year })}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 mb-4">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between py-2">
              <div>
                <div className="text-sm text-gray-900 dark:text-gray-100">{h.name}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(h.date)}
                </div>
              </div>
              {isManager && (
                <button
                  onClick={() => remove(h.id)}
                  className="text-xs text-red-600 hover:text-red-700"
                >
                  {t('common.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isManager && (
        <form onSubmit={add} className="flex flex-wrap gap-2 items-end border-t border-gray-100 dark:border-gray-800 pt-4">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('holidays.date')}</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-1">{t('holidays.name')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('holidays.namePlaceholder')}
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? t('holidays.adding') : t('common.add')}
          </button>
        </form>
      )}
    </section>
  );
}
