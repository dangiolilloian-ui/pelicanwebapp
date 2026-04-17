'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export interface Holiday {
  id: string;
  date: string;
  name: string;
}

export function useHolidays(year?: number) {
  const { token } = useAuth();
  const [holidays, setHolidays] = useState<Holiday[]>([]);

  const fetch = useCallback(async () => {
    if (!token) return;
    try {
      const params = year ? `?year=${year}` : '';
      const data = await api<Holiday[]>(`/holidays${params}`, { token });
      setHolidays(data);
    } catch (err) {
      console.error('Failed to fetch holidays', err);
    }
  }, [token, year]);

  useEffect(() => { fetch(); }, [fetch]);

  return { holidays, fetchHolidays: fetch };
}

/**
 * Returns a Set of "YYYY-MM-DD" date strings for quick lookup.
 */
export function useHolidayDateSet(holidays: Holiday[]): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const m = new Map<string, string>();
    for (const h of holidays) {
      const d = new Date(h.date);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      m.set(key, h.name);
    }
    setMap(m);
  }, [holidays]);

  return map;
}
