'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Position } from '@/types';

export function usePositions() {
  const { token } = useAuth();
  const [positions, setPositions] = useState<Position[]>([]);

  const fetch = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<Position[]>('/positions', { token });
      setPositions(data);
    } catch (err) {
      console.error('Failed to fetch positions', err);
    }
  }, [token]);

  useEffect(() => { fetch(); }, [fetch]);

  return { positions, fetchPositions: fetch };
}
