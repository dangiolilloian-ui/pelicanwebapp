'use client';

import { useState } from 'react';
import { useTeam } from '@/hooks/useTeam';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { AvailabilityModal } from '@/components/AvailabilityModal';
import { EmployeeEditModal } from '@/components/EmployeeEditModal';
import type { User } from '@/types';
import clsx from 'clsx';

export default function TeamPage() {
  const { members, loading, addMember, removeMember, updateMember, generateResetLink } = useTeam();
  const { user } = useAuth();
  const isManager = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'EMPLOYEE' });
  const [error, setError] = useState('');
  const [availabilityFor, setAvailabilityFor] = useState<User | null>(null);
  const [editingMember, setEditingMember] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const t = useT();
  // Holds a freshly-minted invite/reset link plus which employee it's for,
  // so the manager can copy it once and dismiss. We intentionally never
  // persist this client-side — closing the modal forgets it.
  const [linkModal, setLinkModal] = useState<{ name: string; url: string; kind: 'invite' | 'reset' } | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const result = await addMember(form);
      const name = `${form.firstName} ${form.lastName}`;
      setForm({ firstName: '', lastName: '', email: '', password: '', role: 'EMPLOYEE' });
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
      const token = await generateResetLink(m.id);
      if (!token) return;
      setLinkModal({
        name: `${m.firstName} ${m.lastName}`,
        url: `${window.location.origin}/reset/${token}`,
        kind: 'reset',
      });
    } catch (err) {
      console.error('Failed to generate reset link', err);
    }
  };

  const update = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }));

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      OWNER: 'bg-purple-100 text-purple-700',
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
          <div className="grid grid-cols-2 gap-3">
            <input
              type="password" placeholder={t('team.tempPassword')} value={form.password}
              onChange={(e) => update('password', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <select
              value={form.role}
              onChange={(e) => update('role', e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="EMPLOYEE">{t('team.roleEmployee')}</option>
              <option value="MANAGER">{t('team.roleManager')}</option>
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

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('team.searchPlaceholder')}
        className="w-full mb-4 rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
            {t('team.memberCount', { n: members.filter((m) => {
              const q = search.toLowerCase();
              return !q || `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
            }).length })}
          </div>
          {members
            .filter((m) => {
              const q = search.toLowerCase();
              return !q || `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
            })
            .map((m) => (
            <div key={m.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-medium text-indigo-700">
                  {m.firstName[0]}{m.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{m.firstName} {m.lastName}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{m.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {m.pin && (
                  <span className="text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded px-1.5 py-0.5" title={t('team.kioskPinSet')}>
                    PIN
                  </span>
                )}
                {m.weeklyHoursCap != null && (
                  <span className="text-[10px] text-gray-500 dark:text-gray-400" title={t('team.weeklyHoursCap')}>
                    {t('team.hoursCap', { n: m.weeklyHoursCap })}
                  </span>
                )}
                {roleBadge(m.role)}
                <button
                  onClick={() => setAvailabilityFor(m)}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  {t('team.availability')}
                </button>
                {isManager && (
                  <button
                    onClick={() => setEditingMember(m)}
                    className="text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600"
                  >
                    {t('common.edit')}
                  </button>
                )}
                {isManager && m.id !== user?.id && (
                  <button
                    onClick={() => handleResetLink(m)}
                    className="text-xs text-gray-600 dark:text-gray-400 hover:text-indigo-600"
                    title={t('team.generateResetLink')}
                  >
                    {t('team.resetLink')}
                  </button>
                )}
                {isManager && user?.role === 'OWNER' && m.id !== user.id && (
                  <button
                    onClick={() => removeMember(m.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    {t('common.remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

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
              {linkModal.kind === 'invite' ? t('team.inviteLink') : t('team.passwordResetLink')}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('team.linkDesc', { name: linkModal.name })}
            </p>
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
