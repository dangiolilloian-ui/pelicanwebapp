'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { Location } from '@/types';

interface Requirement {
  id: string;
  locationId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  minStaff: number;
  notes: string | null;
  location: { id: string; name: string } | null;
}

export function CoverageRequirementsSection() {
  const { token, user } = useAuth();
  const t = useT();
  const DAYS = [t('availability.sun'), t('availability.mon'), t('availability.tue'), t('availability.wed'), t('availability.thu'), t('availability.fri'), t('availability.sat')];
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [rows, setRows] = useState<Requirement[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [form, setForm] = useState({
    locationId: '',
    dayOfWeek: '1',
    startTime: '09:00',
    endTime: '17:00',
    minStaff: '2',
    notes: '',
  });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [reqs, locs] = await Promise.all([
        api<Requirement[]>('/coverage/requirements', { token }),
        api<Location[]>('/locations', { token }),
      ]);
      setRows(reqs);
      setLocations(locs);
    } catch (err) {
      console.error('Failed to load coverage', err);
    }
  }, [token]);

  useEffect(() => {
    if (isManager) load();
  }, [isManager, load]);

  if (!isManager) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError('');
    try {
      await api('/coverage/requirements', {
        token,
        method: 'POST',
        body: JSON.stringify({
          locationId: form.locationId || null,
          dayOfWeek: Number(form.dayOfWeek),
          startTime: form.startTime,
          endTime: form.endTime,
          minStaff: Number(form.minStaff),
          notes: form.notes || null,
        }),
      });
      setForm({ ...form, minStaff: '2', notes: '' });
      load();
    } catch (err: any) {
      setError(err.message || 'Failed to create');
    }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this requirement?')) return;
    await api(`/coverage/requirements/${id}`, { token, method: 'DELETE' });
    load();
  };

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 mt-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('coverage.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        {t('coverage.desc')}
      </p>

      <form onSubmit={create} className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
        <select
          value={form.dayOfWeek}
          onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
        >
          {DAYS.map((d, i) => (
            <option key={i} value={i}>{d}</option>
          ))}
        </select>
        <input
          type="time" value={form.startTime}
          onChange={(e) => setForm({ ...form, startTime: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
        />
        <input
          type="time" value={form.endTime}
          onChange={(e) => setForm({ ...form, endTime: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
        />
        <input
          type="number" min="1" value={form.minStaff}
          onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
          placeholder={t('coverage.min')}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
        />
        <select
          value={form.locationId}
          onChange={(e) => setForm({ ...form, locationId: e.target.value })}
          className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
        >
          <option value="">{t('common.allLocations')}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {t('coverage.addRule')}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{t('coverage.noRules')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 dark:text-gray-400">
            <tr>
              <th className="text-left py-1.5">{t('coverage.day')}</th>
              <th className="text-left py-1.5">{t('coverage.window')}</th>
              <th className="text-left py-1.5">{t('coverage.location')}</th>
              <th className="text-right py-1.5">{t('coverage.minStaff')}</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-1.5 text-gray-700 dark:text-gray-300">{DAYS[r.dayOfWeek]}</td>
                <td className="py-1.5 text-gray-700 dark:text-gray-300 tabular-nums">
                  {r.startTime} – {r.endTime}
                </td>
                <td className="py-1.5 text-gray-700 dark:text-gray-300">
                  {r.location ? r.location.name : <span className="text-gray-400">{t('coverage.all')}</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-900 dark:text-gray-100">
                  {r.minStaff}
                </td>
                <td className="py-1.5 text-right">
                  <button onClick={() => remove(r.id)} className="text-xs text-red-500 hover:text-red-700">
                    {t('common.remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
