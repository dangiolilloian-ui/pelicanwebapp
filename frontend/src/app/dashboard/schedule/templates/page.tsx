'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useTemplates } from '@/hooks/useTemplates';
import { useTeam } from '@/hooks/useTeam';
import { to12h } from '@/lib/dates';
import type { Position, Location } from '@/types';

interface RecurringShift {
  id: string;
  userId: string | null;
  positionId: string | null;
  locationId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
  active: boolean;
  user: { id: string; firstName: string; lastName: string } | null;
  position: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];


export default function TemplatesPage() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const [positions, setPositions] = useState<Position[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const { templates, create: createTemplate, remove: removeTemplate } = useTemplates();
  const [newTpl, setNewTpl] = useState({ name: '', startTime: '10:00', endTime: '18:00', positionId: '', locationId: '' });

  const { members } = useTeam();
  const [recurring, setRecurring] = useState<RecurringShift[]>([]);
  const todayISO = new Date().toISOString().slice(0, 10);
  const [newRec, setNewRec] = useState({
    userId: '',
    positionId: '',
    locationId: '',
    dayOfWeek: 1,
    startTime: '10:00',
    endTime: '18:00',
    validFrom: todayISO,
    validUntil: '',
  });

  const fetchRecurring = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<RecurringShift[]>('/recurring-shifts', { token });
      setRecurring(data);
    } catch (err) {
      console.error('Failed to load recurring shifts', err);
    }
  }, [token]);

  useEffect(() => { fetchRecurring(); }, [fetchRecurring]);

  const addRecurring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api('/recurring-shifts', {
      token,
      method: 'POST',
      body: JSON.stringify({
        userId: newRec.userId || null,
        positionId: newRec.positionId || null,
        locationId: newRec.locationId || null,
        dayOfWeek: newRec.dayOfWeek,
        startTime: newRec.startTime,
        endTime: newRec.endTime,
        validFrom: newRec.validFrom,
        validUntil: newRec.validUntil || null,
      }),
    });
    setNewRec({ ...newRec, userId: '', positionId: '', locationId: '' });
    fetchRecurring();
  };

  const toggleRecurring = async (id: string, active: boolean) => {
    if (!token) return;
    await api(`/recurring-shifts/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
    fetchRecurring();
  };

  const removeRecurring = async (id: string) => {
    if (!token) return;
    await api(`/recurring-shifts/${id}`, { token, method: 'DELETE' });
    fetchRecurring();
  };

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api<Position[]>('/positions', { token }),
      api<Location[]>('/locations', { token }),
    ]).then(([p, l]) => {
      setPositions(p);
      setLocations(l);
    });
  }, [token]);

  if (!isManager) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">{t('settings.managerOnly')}</div>;
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('templates.pageTitle')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('templates.pageDesc')}</p>
      </div>

      {/* Shift Templates */}
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">{t('settings.shiftTemplates')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('settings.shiftTemplatesDesc')}
        </p>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {templates.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">{t('settings.noTemplates')}</div>
          )}
          {templates.map((tpl) => (
            <div key={tpl.id} className="flex items-center gap-3 px-4 py-2.5">
              {tpl.position && (
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tpl.position.color }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-gray-100 truncate">{tpl.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {to12h(tpl.startTime)}–{to12h(tpl.endTime)}
                  {tpl.position ? ` · ${tpl.position.name}` : ''}
                  {tpl.location ? ` · ${tpl.location.name}` : ''}
                </p>
              </div>
              <button onClick={() => removeTemplate(tpl.id)} className="text-xs text-red-500 hover:text-red-700">{t('common.remove')}</button>
            </div>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newTpl.name) return;
              await createTemplate({
                name: newTpl.name,
                startTime: newTpl.startTime,
                endTime: newTpl.endTime,
                positionId: newTpl.positionId || undefined,
                locationId: newTpl.locationId || undefined,
              });
              setNewTpl({ name: '', startTime: '10:00', endTime: '18:00', positionId: '', locationId: '' });
            }}
            className="flex flex-wrap items-center gap-2 px-4 py-3"
          >
            <input
              type="text" required placeholder={t('settings.templateNamePlaceholder')}
              value={newTpl.name}
              onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })}
              className="flex-1 min-w-[160px] rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input type="time" value={newTpl.startTime}
              onChange={(e) => setNewTpl({ ...newTpl, startTime: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900" />
            <span className="text-xs text-gray-400">–</span>
            <input type="time" value={newTpl.endTime}
              onChange={(e) => setNewTpl({ ...newTpl, endTime: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900" />
            <select value={newTpl.positionId}
              onChange={(e) => setNewTpl({ ...newTpl, positionId: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900">
              <option value="">{t('common.noPosition')}</option>
              {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={newTpl.locationId}
              onChange={(e) => setNewTpl({ ...newTpl, locationId: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900">
              <option value="">{t('common.noLocation')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition">{t('common.add')}</button>
          </form>
        </div>
      </section>

      {/* Recurring Shifts */}
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">{t('settings.recurringShifts')}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          {t('settings.recurringShiftsDesc')}
        </p>
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {recurring.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">{t('settings.noRecurringRules')}</div>
          )}
          {recurring.map((r) => (
            <div key={r.id} className={`flex items-center gap-3 px-4 py-2.5 ${!r.active ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 w-12 shrink-0">
                <span className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                  {DAY_NAMES[r.dayOfWeek]}
                </span>
              </div>
              {r.position && (
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: r.position.color }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                  {to12h(r.startTime)}–{to12h(r.endTime)}
                  {r.user ? ` · ${r.user.firstName} ${r.user.lastName}` : ` · ${t('common.unassigned')}`}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {r.position?.name || t('common.noPosition')}
                  {r.location ? ` · ${r.location.name}` : ''}
                  {r.validUntil ? ` · ${t('settings.until', { date: new Date(r.validUntil).toLocaleDateString() })}` : ''}
                </p>
              </div>
              <button
                onClick={() => toggleRecurring(r.id, !r.active)}
                className={`text-xs rounded px-2 py-1 transition ${
                  r.active
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 hover:bg-green-200'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200'
                }`}
              >
                {r.active ? t('settings.active') : t('settings.paused')}
              </button>
              <button onClick={() => removeRecurring(r.id)} className="text-xs text-red-500 hover:text-red-700">
                {t('common.remove')}
              </button>
            </div>
          ))}
          <form onSubmit={addRecurring} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <select
              value={newRec.dayOfWeek}
              onChange={(e) => setNewRec({ ...newRec, dayOfWeek: Number(e.target.value) })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            >
              {DAY_NAMES.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
            <input
              type="time" value={newRec.startTime}
              onChange={(e) => setNewRec({ ...newRec, startTime: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            />
            <span className="text-xs text-gray-400">–</span>
            <input
              type="time" value={newRec.endTime}
              onChange={(e) => setNewRec({ ...newRec, endTime: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            />
            <select
              value={newRec.userId}
              onChange={(e) => setNewRec({ ...newRec, userId: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            >
              <option value="">{t('common.unassigned')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.firstName} {m.lastName}</option>
              ))}
            </select>
            <select
              value={newRec.positionId}
              onChange={(e) => setNewRec({ ...newRec, positionId: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            >
              <option value="">{t('common.noPosition')}</option>
              {positions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={newRec.locationId}
              onChange={(e) => setNewRec({ ...newRec, locationId: e.target.value })}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            >
              <option value="">{t('common.noLocation')}</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <input
              type="date" value={newRec.validFrom}
              onChange={(e) => setNewRec({ ...newRec, validFrom: e.target.value })}
              title={t('settings.validFrom')}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            />
            <input
              type="date" value={newRec.validUntil}
              onChange={(e) => setNewRec({ ...newRec, validUntil: e.target.value })}
              title={t('settings.validUntil')}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1.5 text-sm bg-white dark:bg-gray-900"
            />
            <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 transition">
              {t('settings.addRule')}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
