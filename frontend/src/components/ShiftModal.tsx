'use client';

import { useState } from 'react';
import type { Shift, User, Position, Location } from '@/types';
import { toDateInputValue, to12h } from '@/lib/dates';
import { useTemplates } from '@/hooks/useTemplates';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface Candidate {
  userId: string;
  name: string;
  availability: 'available' | 'partial' | 'unknown';
  weekHours: number;
  projectedHours: number;
  overtime: boolean;
  overCap: boolean;
}

interface ShiftModalProps {
  shift?: Shift | null;
  defaultDate?: Date;
  defaultUserId?: string;
  members: User[];
  positions?: Position[];
  locations?: Location[];
  onSave: (data: any) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function ShiftModal({ shift, defaultDate, defaultUserId, members, positions = [], locations = [], onSave, onDelete, onClose }: ShiftModalProps) {
  const isEdit = !!shift;
  const t = useT();

  const getInitialDate = () => {
    if (shift) return toDateInputValue(new Date(shift.startTime));
    if (defaultDate) return toDateInputValue(defaultDate);
    return toDateInputValue(new Date());
  };

  // Auto-fill position & location from a member's assignments when they have
  // exactly one of each; leave blank if they have multiple (let the manager pick).
  const autoFillFromMember = (memberId: string) => {
    const m = members.find((x) => x.id === memberId);
    if (!m) return { pos: '', loc: '' };
    const pos = m.positions?.length === 1 ? m.positions[0].id : '';
    const loc = m.locations?.length === 1 ? m.locations[0].id : '';
    return { pos, loc };
  };

  const initialUserId = shift?.user?.id || defaultUserId || '';
  const initialAuto = !isEdit && initialUserId ? autoFillFromMember(initialUserId) : { pos: '', loc: '' };

  const [date, setDate] = useState(getInitialDate);
  const [startTime, setStartTime] = useState(shift ? new Date(shift.startTime).toTimeString().slice(0, 5) : '10:00');
  const [endTime, setEndTime] = useState(shift ? new Date(shift.endTime).toTimeString().slice(0, 5) : '18:00');
  const [userId, setUserId] = useState(initialUserId);
  const [positionId, setPositionId] = useState(shift?.position?.id || initialAuto.pos);
  const [locationId, setLocationId] = useState(shift?.location?.id || initialAuto.loc);

  // When the user changes the assigned employee on a new shift, auto-fill
  // position & location if they have exactly one of each.
  const handleUserChange = (newUserId: string) => {
    setUserId(newUserId);
    if (!isEdit && newUserId) {
      const { pos, loc } = autoFillFromMember(newUserId);
      if (pos) setPositionId(pos);
      if (loc) setLocationId(loc);
    }
  };
  const [notes, setNotes] = useState(shift?.notes || '');
  const [saving, setSaving] = useState(false);
  const { templates } = useTemplates();
  const { token, user: authUser } = useAuth();
  const isManager = authUser?.role === 'OWNER' || authUser?.role === 'ADMIN' || authUser?.role === 'MANAGER';
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  const findCoverage = async () => {
    if (!token || !shift) return;
    setLoadingCandidates(true);
    try {
      const res = await api<{ candidates: Candidate[] }>(`/shifts/${shift.id}/candidates`, { token });
      setCandidates(res.candidates);
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const applyTemplate = (id: string) => {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    setStartTime(tpl.startTime);
    setEndTime(tpl.endTime);
    if (tpl.position) setPositionId(tpl.position.id);
    if (tpl.location) setLocationId(tpl.location.id);
    if (tpl.notes) setNotes(tpl.notes);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Build proper local-time Date objects so the ISO string sent to the
      // backend includes the correct UTC offset (avoids timezone shift bugs).
      const [sy, sm, sd] = date.split('-').map(Number);
      const [sh, smin] = startTime.split(':').map(Number);
      const [eh, emin] = endTime.split(':').map(Number);
      const startDt = new Date(sy, sm - 1, sd, sh, smin, 0);
      const endDt = new Date(sy, sm - 1, sd, eh, emin, 0);
      // Handle overnight shifts (end before start means next day)
      if (endDt <= startDt) endDt.setDate(endDt.getDate() + 1);

      await onSave({
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        userId: userId || null,
        positionId: positionId || null,
        locationId: locationId || null,
        notes: notes || null,
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {isEdit ? t('shiftModal.editShift') : t('shiftModal.newShift')}
        </h2>

        {!isEdit && templates.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.template')}</label>
            <select
              onChange={(e) => applyTemplate(e.target.value)}
              defaultValue=""
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm bg-white dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('shiftModal.templatePlaceholder')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({to12h(tpl.startTime)}–{to12h(tpl.endTime)})
                </option>
              ))}
            </select>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.date')}</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.start')}</label>
              <input
                type="time"
                required
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.end')}</label>
              <input
                type="time"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.assignTo')}</label>
            <select
              value={userId}
              onChange={(e) => handleUserChange(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('common.unassigned')}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.firstName} {m.lastName}
                </option>
              ))}
            </select>
          </div>

          {positions.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.position')}</label>
              <select
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('common.noPosition')}</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          {locations.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.location')}</label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('common.noLocation')}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('shiftModal.notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={t('shiftModal.notesPlaceholder')}
            />
          </div>

          {isEdit && isManager && (
            <div>
              {candidates === null ? (
                <button
                  type="button"
                  onClick={findCoverage}
                  disabled={loadingCandidates}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                >
                  {loadingCandidates ? t('shiftModal.searching') : t('shiftModal.findCoverage')}
                </button>
              ) : (
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 flex justify-between">
                    <span>{t('shiftModal.candidates', { n: candidates.length })}</span>
                    <button type="button" onClick={() => setCandidates(null)} className="text-gray-400 hover:text-gray-600">×</button>
                  </div>
                  {candidates.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">{t('shiftModal.noCandidates')}</div>
                  ) : (
                    <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-800">
                      {candidates.map((c) => (
                        <li key={c.userId} className="flex items-center justify-between px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className={clsx(
                              'h-2 w-2 rounded-full',
                              c.availability === 'available' ? 'bg-green-500' : c.availability === 'partial' ? 'bg-amber-500' : 'bg-gray-400'
                            )} />
                            <button
                              type="button"
                              onClick={() => { setUserId(c.userId); setCandidates(null); }}
                              className="text-sm text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              {c.name}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-gray-500">
                            <span>{t('shiftModal.hoursThisWeek', { n: c.weekHours })}</span>
                            {c.overtime && <span className="text-amber-600 font-medium">{t('shiftModal.ot')}</span>}
                            {c.overCap && <span className="text-red-600 font-medium">{t('shiftModal.cap')}</span>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div>
              {isEdit && onDelete && (
                <button
                  type="button"
                  onClick={async () => { await onDelete(); onClose(); }}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  {t('shiftModal.deleteShift')}
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {saving ? t('common.saving') : isEdit ? t('shiftModal.update') : t('shiftModal.create')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
