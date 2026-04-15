'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Location } from '@/types';

export function useLocations() {
  const { token } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);

  const fetch = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<Location[]>('/locations', { token });
      setLocations(data);
    } catch (err) {
      console.error('Failed to fetch locations', err);
    }
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  return { locations, fetchLocations: fetch };
}
