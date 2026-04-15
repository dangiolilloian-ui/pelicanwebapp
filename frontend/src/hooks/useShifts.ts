'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { addDays } from '@/lib/dates';
import type { Shift } from '@/types';

export function useShifts(rangeStart: Date, rangeEnd?: Date) {
  const { token } = useAuth();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  const start = rangeStart.toISOString();
  const end = (rangeEnd || addDays(rangeStart, 7)).toISOString();

  const fetchShifts = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api<Shift[]>(`/shifts?start=${start}&end=${end}`, { token });
      setShifts(data);
    } catch (err) {
      console.error('Failed to fetch shifts', err);
    } finally {
      setLoading(false);
    }
  }, [token, start, end]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  const createShift = async (data: Partial<Shift>) => {
    if (!token) return;
    const shift = await api<Shift>('/shifts', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    });
    setShifts((prev) => [...prev, shift]);
    return shift;
  };

  const updateShift = async (id: string, data: Partial<Shift>) => {
    if (!token) return;
    const shift = await api<Shift>(`/shifts/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setShifts((prev) => prev.map((s) => (s.id === id ? shift : s)));
    return shift;
  };

  const deleteShift = async (id: string) => {
    if (!token) return;
    await api(`/shifts/${id}`, { token, method: 'DELETE' });
    setShifts((prev) => prev.filter((s) => s.id !== id));
  };

  const publishWeek = async () => {
    if (!token) return { count: 0, coverageGaps: [] as any[] };
    const res = await api<{ message: string; count: number; coverageGaps?: any[] }>(
      '/shifts/publish',
      {
        token,
        method: 'POST',
        body: JSON.stringify({ start, end }),
      }
    );
    await fetchShifts();
    return { count: res.count, coverageGaps: res.coverageGaps ?? [] };
  };

  const copyWeekToNext = async () => {
    if (!token) return;
    const targetStart = addDays(rangeStart, 7).toISOString();
    await api('/shifts/copy-week', {
      token,
      method: 'POST',
      body: JSON.stringify({
        sourceStart: start,
        sourceEnd: end,
        targetStart,
      }),
    });
  };

  const materializeRecurring = async () => {
    if (!token) return { created: 0, skipped: 0 };
    const res = await api<{ created: number; skipped: number }>('/recurring-shifts/materialize', {
      token,
      method: 'POST',
      body: JSON.stringify({ weekStart: rangeStart.toISOString() }),
    });
    await fetchShifts();
    return res;
  };

  const bulkDelete = async (ids: string[]) => {
    if (!token || ids.length === 0) return;
    await api('/shifts/bulk-delete', { token, method: 'POST', body: JSON.stringify({ ids }) });
    setShifts((prev) => prev.filter((s) => !ids.includes(s.id)));
  };

  const bulkAssign = async (ids: string[], userId: string | null) => {
    if (!token || ids.length === 0) return;
    await api('/shifts/bulk-assign', { token, method: 'POST', body: JSON.stringify({ ids, userId }) });
    await fetchShifts();
  };

  const bulkPublish = async (ids: string[]) => {
    if (!token || ids.length === 0) return;
    await api('/shifts/bulk-publish', { token, method: 'POST', body: JSON.stringify({ ids }) });
    await fetchShifts();
  };

  return { shifts, loading, fetchShifts, createShift, updateShift, deleteShift, publishWeek, copyWeekToNext, materializeRecurring, bulkDelete, bulkAssign, bulkPublish };
}
