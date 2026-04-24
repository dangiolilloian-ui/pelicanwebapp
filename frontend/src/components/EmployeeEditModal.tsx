'use client';

import { useState, useEffect, useCallback } from 'react';
import type { User, Role, EmploymentType, Department } from '@/types';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePositions } from '@/hooks/usePositions';
import { useLocations } from '@/hooks/useLocations';

interface EmployeeNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; firstName: string; lastName: string } | null;
}

interface PtoBalance {
  balance: number;
  ytdAccrued: number;
  annualCap: number;
  remainingAccrualHeadroom: number;
  enabled: boolean;
}

interface PtoLedgerEntry {
  id: string;
  delta: number;
  kind: string;
  reason: string | null;
  createdAt: string;
  actor: { firstName: string; lastName: string } | null;
}

interface Props {
  member: User;
  onSave: (data: {
    role?: Role;
    employmentType?: EmploymentType;
    pin?: string | null;
    weeklyHoursCap?: number | null;
    birthDate?: string | null;
    isMinor?: boolean;
    positionIds?: string[];
    locationIds?: string[];
    isStoreManager?: boolean;
    managedLocationIds?: string[];
    managedDepartmentIds?: string[];
  }) => Promise<void>;
  onClose: () => void;
}

export function EmployeeEditModal({ member, onSave, onClose }: Props) {
  const { token, user: currentUser } = useAuth();
  const t = useT();
  // Who can edit role + scope. Matches the backend users-PUT gate: OWNER and
  // ADMIN can, MANAGER can't. ADMIN still can't touch an OWNER, and nobody can
  // change their own role (prevents footguns like locking yourself out).
  const canEditScope = currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN';
  const canChangeRoles =
    canEditScope && member.role !== 'OWNER' && member.id !== currentUser?.id;

  const [role, setRole] = useState<Role>(member.role || 'EMPLOYEE');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(member.employmentType || 'FULL_TIME');
  const [pin, setPin] = useState(member.pin || '');
  const [cap, setCap] = useState(member.weeklyHoursCap != null ? String(member.weeklyHoursCap) : '');
  const [dob, setDob] = useState(member.birthDate ? member.birthDate.slice(0, 10) : '');
  const [minor, setMinor] = useState(member.isMinor ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Positions + locations this employee is assigned to (i.e. what they're
  // trained in and where they physically work). Separate from the manager's
  // *scope* fields below, which live on manager-tier users only.
  const { positions: allPositions } = usePositions();
  const { locations: allLocations } = useLocations();
  const [positionIds, setPositionIds] = useState<Set<string>>(
    () => new Set((member.positions ?? []).map((p) => p.id))
  );
  const [locationIds, setLocationIds] = useState<Set<string>>(
    () => new Set((member.locations ?? []).map((l) => l.id))
  );
  const togglePosition = (id: string) =>
    setPositionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleLocation = (id: string) =>
    setLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Manager scope. Two flavors that map 1:1 to backend/lib/managerScope:
  //   - store manager: full authority at every managedLocation
  //   - dept manager:  scoped to specific managedDepartments (location+positions)
  // The UI shows one or the other based on the toggle, and we only send
  // whichever list is "live" on save so we don't clobber the other side.
  const [isStoreManager, setIsStoreManager] = useState<boolean>(member.isStoreManager ?? false);
  const [managedLocationIds, setManagedLocationIds] = useState<Set<string>>(
    () => new Set((member.managedLocations ?? []).map((l) => l.id))
  );
  const [managedDepartmentIds, setManagedDepartmentIds] = useState<Set<string>>(
    () => new Set((member.managedDepartments ?? []).map((d) => d.id))
  );
  const toggleManagedLocation = (id: string) =>
    setManagedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const toggleManagedDepartment = (id: string) =>
    setManagedDepartmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Departments for the scope picker. Only fetched if the viewer can edit
  // scope AND the current role selection is manager-tier — saves a request
  // on the common case of editing a plain EMPLOYEE.
  const [allDepartments, setAllDepartments] = useState<Department[]>([]);
  const isManagerRole = role === 'MANAGER' || role === 'ADMIN';
  useEffect(() => {
    if (!token || !canEditScope || !isManagerRole) return;
    api<Department[]>('/departments', { token })
      .then(setAllDepartments)
      .catch((err) => console.error('Failed to load departments', err));
  }, [token, canEditScope, isManagerRole]);

  // Manager-only notes — loaded lazily once the modal is open.
  const [notes, setNotes] = useState<EmployeeNote[]>([]);
  const [newNote, setNewNote] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  // PTO side panel — balance + short ledger + manual adjust form.
  const [ptoBalance, setPtoBalance] = useState<PtoBalance | null>(null);
  const [ptoLedger, setPtoLedger] = useState<PtoLedgerEntry[]>([]);
  const [ptoDelta, setPtoDelta] = useState('');
  const [ptoReason, setPtoReason] = useState('');
  const [ptoBusy, setPtoBusy] = useState(false);
  const [ptoError, setPtoError] = useState('');

  const loadPto = useCallback(() => {
    if (!token) return;
    Promise.all([
      api<PtoBalance>(`/pto/balance?userId=${member.id}`, { token }),
      api<PtoLedgerEntry[]>(`/pto/ledger?userId=${member.id}&limit=10`, { token }),
    ])
      .then(([bal, led]) => {
        setPtoBalance(bal);
        setPtoLedger(led);
      })
      .catch((err) => console.error('Failed to load PTO', err));
  }, [token, member.id]);

  useEffect(() => {
    loadPto();
  }, [loadPto]);

  const adjustPto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPtoError('');
    const n = Number(ptoDelta);
    if (!Number.isFinite(n) || n === 0) {
      setPtoError(t('employeeEdit.adjustError'));
      return;
    }
    setPtoBusy(true);
    try {
      await api('/pto/adjust', {
        token,
        method: 'POST',
        body: JSON.stringify({ userId: member.id, delta: n, reason: ptoReason || null }),
      });
      setPtoDelta('');
      setPtoReason('');
      loadPto();
    } catch (err: any) {
      setPtoError(err.message || t('employeeEdit.adjustFailed'));
    } finally {
      setPtoBusy(false);
    }
  };

  const loadNotes = useCallback(() => {
    if (!token) return;
    api<EmployeeNote[]>(`/employee-notes/${member.id}`, { token })
      .then(setNotes)
      .catch((err) => console.error('Failed to load notes', err));
  }, [token, member.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newNote.trim()) return;
    setNoteBusy(true);
    try {
      await api(`/employee-notes/${member.id}`, {
        token,
        method: 'POST',
        body: JSON.stringify({ body: newNote.trim() }),
      });
      setNewNote('');
      loadNotes();
    } finally {
      setNoteBusy(false);
    }
  };

  const deleteNote = async (id: string) => {
    if (!token || !confirm(t('employeeEdit.deleteNote'))) return;
    await api(`/employee-notes/${member.id}/${id}`, { token, method: 'DELETE' });
    loadNotes();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pin && !/^\d{4,6}$/.test(pin)) {
      setError(t('employeeEdit.pinError'));
      return;
    }
    setSaving(true);
    try {
      // Only send scope fields when the viewer is entitled AND the role
      // selection is manager-tier. When demoting to EMPLOYEE we intentionally
      // omit them — the backend detects role===EMPLOYEE and scrubs scope in
      // one transaction, which is cleaner than asking the UI to remember.
      const willBeManagerTier = role === 'MANAGER' || role === 'ADMIN';
      const scopePayload =
        canEditScope && willBeManagerTier
          ? {
              isStoreManager,
              managedLocationIds: isStoreManager ? Array.from(managedLocationIds) : [],
              managedDepartmentIds: isStoreManager ? [] : Array.from(managedDepartmentIds),
            }
          : {};

      await onSave({
        ...(canChangeRoles && role !== member.role ? { role } : {}),
        ...(employmentType !== member.employmentType ? { employmentType } : {}),
        pin: pin === '' ? null : pin,
        weeklyHoursCap: cap === '' ? null : Number(cap),
        birthDate: dob === '' ? null : dob,
        isMinor: minor,
        positionIds: Array.from(positionIds),
        locationIds: Array.from(locationIds),
        ...scopePayload,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || t('employeeEdit.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Group departments by location for the dept picker — managers usually
  // think "I oversee Deli + Bakery at Flemington", not a flat dept list.
  const departmentsByLocation = allDepartments.reduce<Record<string, Department[]>>((acc, d) => {
    const key = d.location?.id || d.locationId;
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});

  // Role options depend on viewer — ADMIN can't hand out OWNER and can't
  // promote above themselves, so we only ever surface EMPLOYEE/MANAGER/ADMIN.
  // OWNER role is conferred via a separate ownership-transfer flow.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('employeeEdit.title', { name: `${member.firstName} ${member.lastName}` })}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t('employeeEdit.desc')}</p>

        <form onSubmit={submit} className="space-y-4">
          {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">{error}</p>}

          {canChangeRoles && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('employeeEdit.role')}
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="EMPLOYEE">{t('employeeEdit.roleEmployee')}</option>
                <option value="MANAGER">{t('employeeEdit.roleManager')}</option>
                <option value="ADMIN">{t('employeeEdit.roleAdmin')}</option>
              </select>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('employeeEdit.roleHint')}
              </p>
            </div>
          )}

          {/* Manager scope. Only shown when the selected role is MANAGER or
              ADMIN and the viewer is entitled. ADMIN users effectively have
              org-wide authority on the backend, but we still let the UI pick
              a scope — it's harmless and keeps the form symmetric. */}
          {canEditScope && isManagerRole && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('employeeEdit.storeManager')}
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('employeeEdit.storeManagerHint')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStoreManager((v) => !v)}
                  className={
                    'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out cursor-pointer ' +
                    (isStoreManager ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700')
                  }
                >
                  <span
                    className={
                      'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ' +
                      (isStoreManager ? 'translate-x-5' : 'translate-x-0')
                    }
                  />
                </button>
              </div>

              {isStoreManager ? (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('employeeEdit.managedLocations')}
                  </label>
                  {allLocations.length === 0 ? (
                    <p className="text-xs text-gray-400">{t('employeeEdit.noLocationsYet')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allLocations.map((l) => {
                        const on = managedLocationIds.has(l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => toggleManagedLocation(l.id)}
                            className={
                              'rounded-full border px-3 py-1 text-xs font-medium transition ' +
                              (on
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400')
                            }
                          >
                            {l.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('employeeEdit.managedLocationsHint')}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('employeeEdit.managedDepartments')}
                  </label>
                  {allDepartments.length === 0 ? (
                    <p className="text-xs text-gray-400">{t('employeeEdit.noDepartmentsYet')}</p>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(departmentsByLocation).map(([locId, depts]) => {
                        const locName = depts[0].location?.name || t('employeeEdit.unknownLocation');
                        return (
                          <div key={locId}>
                            <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
                              {locName}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {depts.map((d) => {
                                const on = managedDepartmentIds.has(d.id);
                                return (
                                  <button
                                    key={d.id}
                                    type="button"
                                    onClick={() => toggleManagedDepartment(d.id)}
                                    className={
                                      'rounded-full border px-3 py-1 text-xs font-medium transition ' +
                                      (on
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400')
                                    }
                                  >
                                    {d.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('employeeEdit.managedDepartmentsHint')}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.employmentType')}
            </label>
            <select
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as typeof employmentType)}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="FULL_TIME">{t('employeeEdit.fullTime')}</option>
              <option value="PART_TIME">{t('employeeEdit.partTime')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.kioskPin')}
            </label>
            <input
              type="text" inputMode="numeric" pattern="\d{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('employeeEdit.pinPlaceholder')}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('employeeEdit.pinHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.weeklyHoursCap')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="1" max="80" step="1"
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                placeholder={t('employeeEdit.noCap')}
                className="w-28 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('employeeEdit.hPerWeek')}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('employeeEdit.capHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.dob')}
            </label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('employeeEdit.dobHint')}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('employeeEdit.minor')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t('employeeEdit.minorHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMinor((v) => !v)}
              className={
                'relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out cursor-pointer ' +
                (minor ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700')
              }
            >
              <span
                className={
                  'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ' +
                  (minor ? 'translate-x-5' : 'translate-x-0')
                }
              />
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.jobPositions')}
            </label>
            {allPositions.length === 0 ? (
              <p className="text-xs text-gray-400">{t('employeeEdit.noPositionsYet')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allPositions.map((p) => {
                  const on = positionIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => togglePosition(p.id)}
                      className={
                        'rounded-full border px-3 py-1 text-xs font-medium transition ' +
                        (on
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400')
                      }
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('employeeEdit.jobPositionsHint')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('employeeEdit.locations')}
            </label>
            {allLocations.length === 0 ? (
              <p className="text-xs text-gray-400">{t('employeeEdit.noLocationsYet')}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allLocations.map((l) => {
                  const on = locationIds.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLocation(l.id)}
                      className={
                        'rounded-full border px-3 py-1 text-xs font-medium transition ' +
                        (on
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400')
                      }
                    >
                      {l.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button" onClick={onClose}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit" disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>

        {ptoBalance && ptoBalance.enabled && (
          <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('employeeEdit.ptoBalance')}</h3>
            <div className="flex items-baseline gap-3 mt-1">
              <span className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {ptoBalance.balance.toFixed(2)}h
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('employeeEdit.ytdAccrued', { accrued: ptoBalance.ytdAccrued.toFixed(2), cap: ptoBalance.annualCap })}
              </span>
            </div>

            <form onSubmit={adjustPto} className="mt-3 flex items-end gap-2">
              <div className="w-24">
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('employeeEdit.ptoHours')}</label>
                <input
                  type="number" step="0.5"
                  value={ptoDelta}
                  onChange={(e) => setPtoDelta(e.target.value)}
                  placeholder={t('employeeEdit.ptoAdjustPlaceholder')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-gray-500 dark:text-gray-400 mb-0.5">{t('employeeEdit.ptoReason')}</label>
                <input
                  type="text"
                  value={ptoReason}
                  onChange={(e) => setPtoReason(e.target.value)}
                  placeholder={t('employeeEdit.ptoReasonPlaceholder')}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-2 py-1 text-sm"
                />
              </div>
              <button
                type="submit" disabled={ptoBusy}
                className="rounded-lg bg-indigo-600 text-white px-3 py-1 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('employeeEdit.adjust')}
              </button>
            </form>
            {ptoError && <p className="text-xs text-red-600 mt-1">{ptoError}</p>}

            {ptoLedger.length > 0 && (
              <ul className="mt-3 space-y-0.5 max-h-32 overflow-y-auto text-[11px]">
                {ptoLedger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between text-gray-600 dark:text-gray-400">
                    <span>
                      <span className="font-mono text-[9px] bg-gray-100 dark:bg-gray-800 rounded px-1 py-0.5 mr-1">
                        {l.kind}
                      </span>
                      {l.reason || '-'}
                      <span className="text-gray-400 ml-1">&middot; {new Date(l.createdAt).toLocaleDateString()}</span>
                    </span>
                    <span className={l.delta >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {l.delta >= 0 ? '+' : ''}{l.delta}h
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{t('employeeEdit.internalNotes')}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t('employeeEdit.notesDesc')}
          </p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {notes.length === 0 ? (
              <p className="text-xs text-gray-400">{t('employeeEdit.noNotes')}</p>
            ) : (
              notes.map((n) => (
                <div
                  key={n.id}
                  className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-3 py-2"
                >
                  <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{n.body}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400">
                      {n.author ? `${n.author.firstName} ${n.author.lastName}` : t('announcements.manager')}
                      {' · '}
                      {new Date(n.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() => deleteNote(n.id)}
                      className="text-[10px] text-red-500 hover:text-red-700"
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <form onSubmit={addNote} className="mt-2 flex items-start gap-2">
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              placeholder={t('employeeEdit.notePlaceholder')}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={noteBusy || !newNote.trim()}
              className="rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {noteBusy ? '...' : t('common.add')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
