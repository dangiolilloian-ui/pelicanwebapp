'use client';

import { useState, useEffect } from 'react';
import { useTeam } from '@/hooks/useTeam';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { AvailabilityModal } from '@/components/AvailabilityModal';
import { EmployeeEditModal } from '@/components/EmployeeEditModal';
import type { User } from '@/types';
import clsx from 'clsx';

export default function TeamPage() {
  const {
    members,
    inactiveMembers,
    inactiveLoaded,
    loading,
    addMember,
    removeMember,
    updateMember,
    generateResetLink,
    deactivateMember,
    activateMember,
    fetchInactive,
  } = useTeam();
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'EMPLOYEE', employmentType: 'FULL_TIME' });
  const [error, setError] = useState('');
  const [availabilityFor, setAvailabilityFor] = useState<User | null>(null);
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  // Which roster we're looking at. Active is the default; Deactivated lazy-
  // loads on first click.
  const [tab, setTab] = useState<'active' | 'inactive'>('active');
  // Confirm-before-destructive dialog. Holds the user we're about to act on
  // plus which action (deactivate | remove) so the same modal serves both.
  const [confirm, setConfirm] = useState<{ member: User; action: 'deactivate' | 'remove' } | null>(null);
  const t = useT();

  useEffect(() => {
    if (tab === 'inactive' && !inactiveLoaded) {
      fetchInactive();
    }
  }, [tab, inactiveLoaded, fetchInactive]);
  // Holds a freshly-minted invite/reset link plus which employee it's for,
  // so the manager can copy it once and dismiss. We intentionally never
  // persist this client-side — closing the modal forgets it.
  const [linkModal, setLinkModal] = useState<{ name: string; url: string; kind: 'invite' | 'reset'; emailedTo?: string | null } | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);

  useEffect(() => {
    if (isManager) {
      const token = localStorage.getItem('token');
      api<{ inviteCode: string }>('/org/invite-code', { token })
        .then((data) => setInviteCode(data.inviteCode))
        .catch(() => {});
    }
  }, [isManager]);

  const regenerateInviteCode = async () => {
    const token = localStorage.getItem('token');
    const data = await api<{ inviteCode: string }>('/org/invite-code/regenerate', { method: 'POST', token });
    setInviteCode(data.inviteCode);
    setInviteCopied(false);
  };

  const copyInviteLink = () => {
    if (!inviteCode) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await addMember(form);
      const name = `${form.firstName} ${form.lastName}`;
      setForm({ firstName: '', lastName: '', email: '', password: '', role: 'EMPLOYEE', employmentType: 'FULL_TIME' });
      setShowForm(false);
      if (result?.inviteToken) {
        setLinkModal({
          name,
          url: `${window.location.origin}/reset/${result.inviteToken}`,
          kind: 'invite',
        });
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetLink = async (m: User) => {
    try {
      const result = await generateResetLink(m.id);
      if (!result) return;
      setLinkModal({
        name: `${m.firstName} ${m.lastName}`,
        url: `${window.location.origin}/reset/${result.token}`,
        kind: 'reset',
        emailedTo: result.emailed ? result.sentTo : null,
      });
    } catch (err) {
      console.error('Failed to generate reset link', err);
    }
  };

  // Client-side predicate for whether `user` can act on `target`. Matches the
  // backend's canManageTarget. We show/hide buttons based on this so a manager
  // doesn't see a Deactivate button they'd just get a 403 for — but the
  // backend still enforces it on the actual call as the source of truth.
  const canAct = (target: User): boolean => {
    if (!user || target.id === user.id) return false;
    if (user.role === 'OWNER') return true;
    if (user.role === 'ADMIN') return target.role !== 'OWNER';
    if (user.role === 'MANAGER') {
      if (target.role !== 'EMPLOYEE') return false;
      // Mirror of backend/lib/managerScope.coversUser. Keep in sync.
      const myLocs = new Set((user.managedLocations || []).map((l) => l.id));
      const myDepts = user.managedDepartments || [];
      // Back-compat: manager-tier with nothing configured sees everything.
      if (myLocs.size === 0 && myDepts.length === 0) return true;
      const targetLocIds = (target.locations || []).map((l) => l.id);
      if (user.isStoreManager) {
        return targetLocIds.some((id) => myLocs.has(id));
      }
      const targetPosIds = new Set((target.positions || []).map((p) => p.id));
      for (const d of myDepts) {
        if (!targetLocIds.includes(d.locationId)) continue;
        if (targetPosIds.size === 0) return true;
        const deptPosIds = (d.positions || []).map((p) => p.id);
        if (deptPosIds.some((id) => targetPosIds.has(id))) return true;
      }
      return false;
    }
    return false;
  };

  const runConfirm = async () => {
    if (!confirm) return;
    try {
      if (confirm.action === 'deactivate') {
        await deactivateMember(confirm.member.id);
      } else {
        await removeMember(confirm.member.id);
      }
      setConfirm(null);
    } catch (err: any) {
      setConfirm(null);
      setError(err.message || 'Action failed');
    }
  };

  const handleActivate = async (m: User) => {
    try {
      await activateMember(m.id);
    } catch (err: any) {
      setError(err.message || 'Activate failed');
    }
  };

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      OWNER: 'bg-purple-100 text-purple-700',
      ADMIN: 'bg-indigo-100 text-indigo-700',
      MANAGER: 'bg-blue-100 text-blue-700',
      EMPLOYEE: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
    };
    return (
      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', colors[role] || colors.EMPLOYEE)}>
        {role}
      </span>
    );
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{t('team.title')}</h1>
        {isManager && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            {showForm ? t('common.cancel') : t('team.addMember')}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-6 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <input
              type="text" required placeholder={t('team.firstName')} value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text" required placeholder={t('team.lastName')} value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <input
            type="email" required placeholder={t('team.email')} value={form.email}
            onChange={(e) => update('email', e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password" placeholder={t('team.tempPassword')} value={form.password}
            onChange={(e) => update('password', e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="EMPLOYEE">{t('team.roleEmployee')}</option>
              <option value="MANAGER">{t('team.roleManager')}</option>
              <option value="ADMIN">Admin</option>
            </select>
            <select
              value={form.employmentType}
              onChange={(e) => update('employmentType', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="FULL_TIME">Full Time</option>
              <option value="PART_TIME">Part Time</option>
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition"
          >
            {t('team.addButton')}
          </button>
        </form>
      )}

      {isManager && inviteCode && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Employee Invite Link</h3>
            <button
              onClick={regenerateInviteCode}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600"
            >
              Regenerate
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Share this link with new employees so they can create their own account and join your team.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text" readOnly
              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/join/${inviteCode}`}
              onFocus={(e) => e.target.select()}
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-xs font-mono"
            />
            <button
              onClick={copyInviteLink}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700 transition whitespace-nowrap"
            >
              {inviteCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Active / Deactivated tabs. Managers rarely look at the deactivated
          list, so we keep Active as the default and lazy-load inactive. */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setTab('active')}
          className={clsx(
            'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition',
            tab === 'active'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'
          )}
        >
          {t('team.tabActive')} <span className="text-xs text-gray-400">({members.length})</span>
        </button>
        <button
          onClick={() => setTab('inactive')}
          className={clsx(
            'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition',
            tab === 'inactive'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-900 dark:hover:text-gray-100'
          )}
        >
          {t('team.tabInactive')}{' '}
          {inactiveLoaded && <span className="text-xs text-gray-400">({inactiveMembers.length})</span>}
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-xs text-red-600 hover:text-red-800">
            {t('common.dismiss') || 'Dismiss'}
          </button>
        </div>
      )}

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('team.searchPlaceholder')}
        className="w-full mb-4 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {(() => {
        const sourceList = tab === 'active' ? members : inactiveMembers;
        const q = search.toLowerCase();
        const filtered = sourceList.filter((m) => {
          return !q || `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
        });
        const showSpinner = loading && tab === 'active';
        const showEmpty =
          !showSpinner &&
          filtered.length === 0 &&
          (tab === 'active' || inactiveLoaded);

        if (showSpinner) {
          return (
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            </div>
          );
        }

        return (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
              {tab === 'active'
                ? (() => {
                    const ft = filtered.filter((m) => m.employmentType !== 'PART_TIME').length;
                    const pt = filtered.filter((m) => m.employmentType === 'PART_TIME').length;
                    return `${filtered.length} members — ${ft} full time — ${pt} part time`;
                  })()
                : `${filtered.length} ${t('team.tabInactive').toLowerCase()}`}
            </div>

            {showEmpty && (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {tab === 'inactive' ? t('team.noDeactivated') : t('team.noResults') || 'No matches'}
              </div>
            )}

            {filtered.map((m) => {
              const inactive = tab === 'inactive';
              return (
                <div
                  key={m.id}
                  className={clsx(
                    'flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50',
                    inactive && 'opacity-70'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={clsx(
                      'h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium',
                      inactive
                        ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                        : 'bg-indigo-100 text-indigo-700'
                    )}>
                      {m.firstName[0]}{m.lastName[0]}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.firstName} {m.lastName}</p>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-xs text-gray-500 dark:text-gray-400">{m.email}</span>
                        {m.positions && m.positions.length > 0 && m.positions.map((p) => (
                          <span key={p.id} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                            {p.name}
                          </span>
                        ))}
                        {m.locations && m.locations.length > 0 && m.locations.map((l) => (
                          <span key={l.id} className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">
                            {l.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.pin && !inactive && (
                      <span className="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded px-1.5 py-0.5" title={t('team.kioskPinSet')}>
                        PIN
                      </span>
                    )}
                    {m.isMinor && !inactive && (
                      <span className="text-[10px] bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded-full px-2 py-0.5 font-medium">
                        Minor
                      </span>
                    )}
                    {m.weeklyHoursCap != null && !inactive && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400" title={t('team.weeklyHoursCap')}>
                        {t('team.hoursCap', { n: m.weeklyHoursCap })}
                      </span>
                    )}
                    {inactive && (
                      <span className="text-[10px] bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full px-2 py-0.5 font-medium">
                        {t('team.inactiveBadge')}
                      </span>
                    )}
                    {roleBadge(m.role)}
                    {!inactive && (
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium',
                        m.employmentType === 'PART_TIME'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                      )}>
                        {m.employmentType === 'PART_TIME' ? 'PT' : 'FT'}
                      </span>
                    )}

                    {!inactive && (
                      <button
                        onClick={() => setAvailabilityFor(m)}
                        className="text-xs text-indigo-600 hover:text-indigo-800"
                      >
                        {t('team.availability')}
                      </button>
                    )}

                    {isManager && (
                      <button
                        onClick={() => setEditingMember(m)}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600"
                      >
                        {t('common.edit')}
                      </button>
                    )}

                    {!inactive && isManager && m.id !== user?.id && (
                      <button
                        onClick={() => handleResetLink(m)}
                        className="text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600"
                        title={t('team.generateResetLink')}
                      >
                        {t('team.resetLink')}
                      </button>
                    )}

                    {!inactive && canAct(m) && (
                      <button
                        onClick={() => setConfirm({ member: m, action: 'deactivate' })}
                        className="text-xs text-amber-600 hover:text-amber-800"
                        title={t('team.deactivateHint')}
                      >
                        {t('team.deactivate')}
                      </button>
                    )}

                    {inactive && canAct(m) && (
                      <button
                        onClick={() => handleActivate(m)}
                        className="text-xs text-green-600 hover:text-green-800"
                      >
                        {t('team.activate')}
                      </button>
                    )}

                    {canAct(m) && (
                      <button
                        onClick={() => setConfirm({ member: m, action: 'remove' })}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        {t('team.deleteUser')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {availabilityFor && (
        <AvailabilityModal member={availabilityFor} onClose={() => setAvailabilityFor(null)} />
      )}

      {editingMember && (
        <EmployeeEditModal
          member={editingMember}
          onSave={async (data) => { await updateMember(editingMember.id, data); }}
          onClose={() => setEditingMember(null)}
        />
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setConfirm(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
              {confirm.action === 'deactivate' ? t('team.deactivateTitle') : t('team.removeTitle')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {confirm.action === 'deactivate'
                ? t('team.deactivateBody', { name: `${confirm.member.firstName} ${confirm.member.lastName}` })
                : t('team.removeBody', { name: `${confirm.member.firstName} ${confirm.member.lastName}` })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirm(null)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={runConfirm}
                className={clsx(
                  'rounded-lg px-4 py-2 text-sm font-medium text-white transition',
                  confirm.action === 'deactivate'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-red-600 hover:bg-red-700'
                )}
              >
                {confirm.action === 'deactivate' ? t('team.deactivate') : t('team.deleteUser')}
              </button>
            </div>
          </div>
        </div>
      )}

      {linkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setLinkModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {linkModal.kind === 'invite'
                ? t('team.inviteLink')
                : linkModal.emailedTo
                  ? t('team.passwordResetLinkSent', { name: linkModal.name })
                  : t('team.passwordResetLink')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {linkModal.kind === 'reset' && linkModal.emailedTo
                ? t('team.resetLinkBackupNote', { name: linkModal.name })
                : t('team.linkDesc', { name: linkModal.name })}
            </p>
            {linkModal.emailedTo && (
              <div className="mb-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2">
                <p className="text-xs text-green-800 dark:text-green-300">
                  <span className="font-medium">{t('team.emailSent')}</span>{' '}
                  <span className="font-mono">{linkModal.emailedTo}</span>
                </p>
              </div>
            )}
            {linkModal.kind === 'reset' && linkModal.emailedTo === null && (
              <div className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
                <p className="text-xs text-red-800 dark:text-red-300 font-medium">
                  {t('team.emailFailedTitle')}
                </p>
                <p className="text-[11px] text-red-700 dark:text-red-400 mt-0.5">
                  {t('team.emailFailedHint', { name: linkModal.name })}
                </p>
              </div>
            )}
            <div className="flex items-center gap-2 mb-4">
              <input
                type="text" readOnly value={linkModal.url}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 px-3 py-2 text-xs font-mono"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(linkModal.url);
                }}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
              >
                {t('common.copy')}
              </button>
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setLinkModal(null)}
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {t('common.done')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
