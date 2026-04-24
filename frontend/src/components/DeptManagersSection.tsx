'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { usePositions } from '@/hooks/usePositions';
import { useLocations } from '@/hooks/useLocations';
import type { Department, User } from '@/types';
import clsx from 'clsx';

// Settings -> Departments. A department is a named slice of one location with
// a set of positions attached and a set of manager users assigned. This is
// the shape backend/lib/managerScope consults when deciding what a dept
// manager can see/do, so every edit here moves the visibility boundary for
// those managers in real time.
//
// Gated to OWNER/ADMIN — matches the /api/departments route's requireRole.
// MANAGER sees a read-only variant (no create/edit buttons, no picker).
export function DeptManagersSection() {
  const { token, user } = useAuth();
  const t = useT();
  const canEdit = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const { positions: allPositions } = usePositions();
  const { locations: allLocations } = useLocations();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [orgMembers, setOrgMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    if (!token) return;
    setError('');
    try {
      const [depts, users] = await Promise.all([
        api<Department[]>('/departments', { token }),
        // Only load the pool of assignable managers if we can edit — saves a
        // request for plain managers reading the page.
        canEdit
          ? api<User[]>('/users', { token })
          : Promise.resolve([] as User[]),
      ]);
      setDepartments(depts);
      setOrgMembers(
        users.filter((u) => ['OWNER', 'ADMIN', 'MANAGER'].includes(u.role)),
      );
    } catch (err: any) {
      setError(err.message || t('settings.departments.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [token, canEdit, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Create form state — kept simple (single-location per department, any
  // number of positions), uniqueness is enforced server-side via a
  // (locationId, name) unique index which will bubble up as a 409.
  const [newName, setNewName] = useState('');
  const [newLocationId, setNewLocationId] = useState<string>('');
  const [newPositionIds, setNewPositionIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

  const createDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim() || !newLocationId) return;
    setCreating(true);
    setError('');
    try {
      const created = await api<Department>('/departments', {
        token,
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          locationId: newLocationId,
          positionIds: Array.from(newPositionIds),
        }),
      });
      setDepartments((prev) => [...prev, created]);
      setNewName('');
      setNewLocationId('');
      setNewPositionIds(new Set());
    } catch (err: any) {
      setError(err.message || t('settings.departments.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const deleteDepartment = async (id: string) => {
    if (!token) return;
    if (!confirm(t('settings.departments.deleteConfirm'))) return;
    try {
      await api(`/departments/${id}`, { token, method: 'DELETE' });
      setDepartments((prev) => prev.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.message || t('settings.departments.deleteFailed'));
    }
  };

  const saveDepartment = async (
    id: string,
    data: { name?: string; positionIds?: string[]; managerIds?: string[] },
  ) => {
    if (!token) return;
    const updated = await api<Department>(`/departments/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setDepartments((prev) => prev.map((d) => (d.id === id ? updated : d)));
  };

  if (loading) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3">
          {t('settings.departments.title')}
        </h2>
        <div className="text-sm text-gray-400">{t('common.loading')}</div>
      </section>
    );
  }

  // Group departments by location for display — managers reason about
  // "Deli + Bakery at Flemington", not a flat list.
  const byLocation = departments.reduce<Record<string, Department[]>>((acc, d) => {
    const key = d.location?.id || d.locationId;
    (acc[key] = acc[key] || []).push(d);
    return acc;
  }, {});

  return (
    <section>
      <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">
        {t('settings.departments.title')}
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('settings.departments.desc')}
      </p>

      {error && (
        <div className="mb-3 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {Object.entries(byLocation).length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-400">
            {t('settings.departments.none')}
          </div>
        )}

        {Object.entries(byLocation).map(([locId, depts]) => {
          const locName = depts[0].location?.name ||
            allLocations.find((l) => l.id === locId)?.name ||
            t('settings.departments.unknownLocation');
          return (
            <div key={locId}>
              <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                {locName}
              </div>
              {depts.map((d) => (
                <DepartmentRow
                  key={d.id}
                  dept={d}
                  allPositions={allPositions}
                  allManagers={orgMembers}
                  canEdit={canEdit}
                  onSave={(data) => saveDepartment(d.id, data)}
                  onDelete={() => deleteDepartment(d.id)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <form
          onSubmit={createDepartment}
          className="mt-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-3 space-y-2"
        >
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('settings.departments.addNew')}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('settings.departments.namePlaceholder')}
              className="flex-1 min-w-[180px] rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />
            <select
              value={newLocationId}
              onChange={(e) => setNewLocationId(e.target.value)}
              required
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('settings.departments.chooseLocation')}</option>
              {allLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          {allPositions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {t('settings.departments.positionsLabel')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allPositions.map((p) => {
                  const on = newPositionIds.has(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        setNewPositionIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                          return next;
                        })
                      }
                      className={clsx(
                        'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition',
                        on
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400',
                      )}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div>
            <button
              type="submit"
              disabled={creating || !newName.trim() || !newLocationId}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {creating ? t('common.saving') : t('settings.departments.create')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function DepartmentRow({
  dept,
  allPositions,
  allManagers,
  canEdit,
  onSave,
  onDelete,
}: {
  dept: Department;
  allPositions: { id: string; name: string; color: string }[];
  allManagers: User[];
  canEdit: boolean;
  onSave: (data: { name?: string; positionIds?: string[]; managerIds?: string[] }) => Promise<void>;
  onDelete: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(dept.name);
  const [positionIds, setPositionIds] = useState<Set<string>>(
    () => new Set((dept.positions || []).map((p) => p.id)),
  );
  const [managerIds, setManagerIds] = useState<Set<string>>(
    () => new Set((dept.managers || []).map((m) => m.id)),
  );

  const reset = () => {
    setName(dept.name);
    setPositionIds(new Set((dept.positions || []).map((p) => p.id)));
    setManagerIds(new Set((dept.managers || []).map((m) => m.id)));
    setEditing(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        positionIds: Array.from(positionIds),
        managerIds: Array.from(managerIds),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="px-4 py-3">
      {!editing ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{dept.name}</div>
            {(dept.positions && dept.positions.length > 0) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {dept.positions.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 px-2 py-0.5 text-[10px] font-medium"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {dept.managers && dept.managers.length > 0 ? (
                dept.managers.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px] font-medium"
                  >
                    {m.firstName} {m.lastName[0]}.
                  </span>
                ))
              ) : (
                <span className="text-xs text-gray-400">{t('settings.departments.noManagers')}</span>
              )}
            </div>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t('common.edit')}
              </button>
              <button
                onClick={onDelete}
                className="text-xs text-red-500 hover:text-red-700"
              >
                {t('common.delete')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-sm"
          />

          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              {t('settings.departments.positionsLabel')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allPositions.map((p) => {
                const on = positionIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setPositionIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                        return next;
                      })
                    }
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
                      on
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:border-indigo-400',
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
              {t('settings.departments.managersLabel')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {allManagers.map((m) => {
                const on = managerIds.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      setManagerIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                        return next;
                      })
                    }
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition',
                      on
                        ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300',
                    )}
                  >
                    {m.firstName} {m.lastName}
                    <span className="text-[9px] opacity-60 uppercase">{m.role}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !name.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
