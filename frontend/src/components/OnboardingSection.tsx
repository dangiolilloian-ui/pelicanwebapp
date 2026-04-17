'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

interface Task {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
}

// Org-level onboarding template. Managers edit the list here; new EMPLOYEE
// users get these instantiated into per-user progress rows at creation time.
export function OnboardingSection() {
  const { token, user } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api<Task[]>('/onboarding/template', { token });
      setTasks(data);
    } catch (e: any) {
      setError(e.message || t('onboarding.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !title.trim()) return;
    setSaving(true);
    try {
      await api('/onboarding/template', {
        token,
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          sortOrder: tasks.length,
        }),
      });
      setTitle('');
      setDescription('');
      await load();
    } catch (e: any) {
      setError(e.message || t('onboarding.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token) return;
    if (!confirm(t('onboarding.removeConfirm'))) return;
    try {
      await api(`/onboarding/template/${id}`, { token, method: 'DELETE' });
      setTasks((prev) => prev.filter((x) => x.id !== id));
    } catch (e: any) {
      setError(e.message || t('onboarding.deleteFailed'));
    }
  };

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t('onboarding.title')}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-4">
        {t('onboarding.desc')}
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
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-2">{t('onboarding.noTasks')}</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800 mb-4">
          {tasks.map((tk) => (
            <li key={tk.id} className="flex items-start justify-between py-2 gap-3">
              <div className="flex-1">
                <div className="text-sm text-gray-900 dark:text-gray-100">{tk.title}</div>
                {tk.description && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{tk.description}</div>
                )}
              </div>
              {isManager && (
                <button onClick={() => remove(tk.id)} className="text-xs text-red-600 hover:text-red-700 shrink-0">
                  {t('common.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {isManager && (
        <form onSubmit={add} className="border-t border-gray-100 dark:border-gray-800 pt-4 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('onboarding.taskPlaceholder')}
            required
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('onboarding.notesPlaceholder')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? t('onboarding.adding') : t('onboarding.addTask')}
          </button>
        </form>
      )}
    </section>
  );
}
