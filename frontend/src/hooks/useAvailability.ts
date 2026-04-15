'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export interface AvailabilityEntry {
  id: string;
  userId: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  available: boolean;
}

export interface TimeOffEntry {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED';
}

/**
 * Loads org-wide availability rules and approved/pending time-off, so the
 * schedule grid can paint each employee×day cell with its status.
 *
 * Availability rarely changes (employees declare it once) so we load the
 * full set for the org. Time-off is filtered to APPROVED only — pending
 * requests shouldn't block the scheduler, just inform.
 */
export function useAvailability() {
  const { token } = useAuth();
  const [availabilities, setAvailabilities] = useState<AvailabilityEntry[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [av, to] = await Promise.all([
          api<AvailabilityEntry[]>('/availability', { token }),
          api<TimeOffEntry[]>('/timeoff?status=APPROVED', { token }),
        ]);
        if (!cancelled) {
          setAvailabilities(av);
          setTimeOff(to);
        }
      } catch (err) {
        console.error('Failed to load availability overlay', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return { availabilities, timeOff };
}
