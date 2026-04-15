'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  notes: string | null;
  position: { id: string; name: string; color: string } | null;
  location: { id: string; name: string } | null;
}

export function useTemplates() {
  const { token } = useAuth();
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);

  const fetchAll = useCallback(async () => {
    if (!token) return;
    const data = await api<ShiftTemplate[]>('/templates', { token });
    setTemplates(data);
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const create = async (data: Partial<ShiftTemplate> & { positionId?: string; locationId?: string }) => {
    if (!token) return;
    const t = await api<ShiftTemplate>('/templates', {
      token, method: 'POST', body: JSON.stringify(data),
    });
    setTemplates((p) => [...p, t]);
    return t;
  };

  const remove = async (id: string) => {
    if (!token) return;
    await api(`/templates/${id}`, { token, method: 'DELETE' });
    setTemplates((p) => p.filter((t) => t.id !== id));
  };

  return { templates, create, remove, refresh: fetchAll };
}
