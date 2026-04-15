'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useLocations } from '@/hooks/useLocations';
import { useT } from '@/lib/i18n';

interface ChecklistItem {
  id: string;
  label: string;
  position: number;
}

interface ChecklistTemplate {
  id: string;
  name: string;
  locationId: string | null;
  items: ChecklistItem[];
}

export function ChecklistsSection() {
  const t = useT();
  const { token } = useAuth();
  const { locations } = useLocations();
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newLoc, setNewLoc] = useState('');
  const [newItems, setNewItems] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    api<ChecklistTemplate[]>('/checklists', { token })
      .then(setTemplates)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const locationName = (id: string | null) => {
    if (!id) return t('common.allLocations');
    return locations.find((l) => l.id === id)?.name ?? '—';
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !newName.trim()) return;
    const items = newItems
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label }));
    setSaving(true);
    try {
      await api('/checklists', {
        token,
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          locationId: newLoc || null,
          items,
        }),
      });
      setNewName('');
      setNewLoc('');
      setNewItems('');
      load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !confirm(t('checklists.deleteConfirm'))) return;
    await api(`/checklists/${id}`, { token, method: 'DELETE' });
    load();
  };

  const addItem = async (templateId: string, label: string) => {
    if (!token || !label.trim()) return;
    await api(`/checklists/${templateId}/items`, {
      token,
      method: 'POST',
      body: JSON.stringify({ label: label.trim() }),
    });
    load();
  };

  const deleteItem = async (templateId: string, itemId: string) => {
    if (!token) return;
    await api(`/checklists/${templateId}/items/${itemId}`, { token, method: 'DELETE' });
    load();
  };

  return (
    <section>
      <h2 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-1">{t('checklists.title')}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {t('checklists.desc')}
      </p>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {loading ? (
          <div className="px-4 py-3 text-sm text-gray-400">{t('common.loading')}</div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-3 text-sm text-gray-400">{t('checklists.noChecklists')}</div>
        ) : (
          templates.map((tmpl) => (
            <TemplateRow
              key={tmpl.id}
              template={tmpl}
              locationLabel={locationName(tmpl.locationId)}
              onDelete={() => remove(tmpl.id)}
              onAddItem={(label) => addItem(tmpl.id, label)}
              onDeleteItem={(itemId) => deleteItem(tmpl.id, itemId)}
            />
          ))
        )}

        <form onSubmit={create} className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('checklists.namePlaceholder')}
              required
              className="flex-1 min-w-[180px] rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
            />
            <select
              value={newLoc}
              onChange={(e) => setNewLoc(e.target.value)}
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1.5 text-sm"
            >
              <option value="">{t('common.allLocations')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <textarea
            value={newItems}
            onChange={(e) => setNewItems(e.target.value)}
            rows={3}
            placeholder={t('checklists.tasksPlaceholder')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-1.5 text-sm"
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving || !newName.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? t('checklists.creating') : t('checklists.createChecklist')}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TemplateRow({
  template,
  locationLabel,
  onDelete,
  onAddItem,
  onDeleteItem,
}: {
  template: ChecklistTemplate;
  locationLabel: string;
  onDelete: () => void;
  onAddItem: (label: string) => void;
  onDeleteItem: (itemId: string) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 text-left min-w-0"
        >
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {template.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {locationLabel} · {t('checklists.items', { n: template.items.length })}
          </p>
        </button>
        <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-700">
          {t('common.remove')}
        </button>
      </div>
      {expanded && (
        <div className="mt-2 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900 space-y-1">
          {template.items.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm">
              <span className="text-gray-700 dark:text-gray-300">• {i.label}</span>
              <button
                onClick={() => onDeleteItem(i.id)}
                className="text-[10px] text-red-500 hover:text-red-700"
              >
                ✕
              </button>
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newItemLabel.trim()) {
                onAddItem(newItemLabel);
                setNewItemLabel('');
              }
            }}
            className="flex items-center gap-2 pt-1"
          >
            <input
              value={newItemLabel}
              onChange={(e) => setNewItemLabel(e.target.value)}
              placeholder={t('checklists.addItemPlaceholder')}
              className="flex-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-1 text-xs"
            />
            <button
              type="submit"
              disabled={!newItemLabel.trim()}
              className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
            >
              {t('common.add')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
