'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import clsx from 'clsx';

interface Manager {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

interface DeptPosition {
  id: string;
  name: string;
  color: string;
  managers: Manager[];
}

interface DeptLocation {
  id: string;
  name: string;
  managers: Manager[];
}

interface OrgMembers {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export function DeptManagersSection() {
  const { token, user } = useAuth();
  const isOwnerOrAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const [positions, setPositions] = useState<DeptPosition[]>([]);
  const [locations, setLocations] = useState<DeptLocation[]>([]);
  const [managers, setManagers] = useState<OrgMembers[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const [deptData, allUsers] = await Promise.all([
        api<{ positions: DeptPosition[]; locations: DeptLocation[] }>('/org/dept-managers', { token }),
        api<OrgMembers[]>('/users', { token }),
      ]);
      setPositions(deptData.positions);
      setLocations(deptData.locations);
      // Only show OWNER/ADMIN/MANAGER as assignable managers
      setManagers(allUsers.filter((u) => ['OWNER', 'ADMIN', 'MANAGER'].includes(u.role)));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updatePositionManagers = async (positionId: string, managerIds: string[]) => {
    if (!token) return;
    await api(`/org/dept-managers/position/${positionId}`, {
      token,
      method: 'PUT',
      body: JSON.stringify({ managerIds }),
    });
    fetchData();
  };

  const updateLocationManagers = async (locationId: string, managerIds: string[]) => {
    if (!token) return;
    await api(`/org/dept-managers/location/${locationId}`, {
      token,
      method: 'PUT',
      body: JSON.stringify({ managerIds }),
    });
    fetchData();
  };

  if (loading) {
    return (
      <section>
        <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-3">Department Managers</h2>
        <div className="text-sm text-gray-400">Loading…</div>
      </section>
    );
  }

  if (positions.length === 0 && locations.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">Department Managers</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        Assign managers to positions and locations. They&apos;ll be notified of time-off requests, swaps, and open shifts for their departments. If none are assigned, owners get notified.
      </p>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {/* Positions */}
        {positions.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              Positions
            </div>
            {positions.map((p) => (
              <DeptRow
                key={p.id}
                label={p.name}
                color={p.color}
                currentManagers={p.managers}
                allManagers={managers}
                canEdit={!!isOwnerOrAdmin}
                onSave={(ids) => updatePositionManagers(p.id, ids)}
              />
            ))}
          </div>
        )}

        {/* Locations */}
        {locations.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/60 text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
              Locations
            </div>
            {locations.map((l) => (
              <DeptRow
                key={l.id}
                label={l.name}
                currentManagers={l.managers}
                allManagers={managers}
                canEdit={!!isOwnerOrAdmin}
                onSave={(ids) => updateLocationManagers(l.id, ids)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DeptRow({
  label,
  color,
  currentManagers,
  allManagers,
  canEdit,
  onSave,
}: {
  label: string;
  color?: string;
  currentManagers: Manager[];
  allManagers: OrgMembers[];
  canEdit: boolean;
  onSave: (managerIds: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(currentManagers.map((m) => m.id)));
  const [saving, setSaving] = useState(false);

  const toggleManager = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave([...selected]);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setSelected(new Set(currentManagers.map((m) => m.id)));
    setEditing(false);
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {color && <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />}
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        </div>

        {!editing && (
          <div className="flex items-center gap-2">
            {currentManagers.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {currentManagers.map((m) => (
                  <span
                    key={m.id}
                    className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px] font-medium"
                  >
                    {m.firstName} {m.lastName[0]}.
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400">No manager assigned</span>
            )}
            {canEdit && (
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                Edit
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
          <div className="flex flex-wrap gap-2 mb-3">
            {allManagers.map((m) => {
              const isSelected = selected.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleManager(m.id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition border',
                    isSelected
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300'
                      : 'bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                  )}
                >
                  {isSelected && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  )}
                  {m.firstName} {m.lastName}
                  <span className="text-[9px] opacity-60 uppercase">{m.role}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={cancel}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
