'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { User } from '@/types';

export function useTeam() {
  const { token } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [inactiveMembers, setInactiveMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inactiveLoaded, setInactiveLoaded] = useState(false);

  const fetchMembers = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api<User[]>('/users', { token });
      setMembers(data);
    } catch (err) {
      console.error('Failed to fetch team', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Lazy — only pulled when the manager flips to the Deactivated tab so the
  // normal active roster load doesn't pay for a list we rarely show.
  const fetchInactive = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api<User[]>('/users?status=inactive', { token });
      setInactiveMembers(data);
      setInactiveLoaded(true);
    } catch (err) {
      console.error('Failed to fetch inactive team', err);
    }
  }, [token]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Password is optional now: leaving it blank generates a single-use invite
  // link that the manager can forward to the new employee. The backend
  // returns `inviteToken` when that path is taken.
  const addMember = async (data: { email: string; firstName: string; lastName: string; phone?: string; role?: string; employmentType?: string; password?: string }) => {
    if (!token) return;
    const user = await api<User & { inviteToken?: string | null }>('/users', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    });
    setMembers((prev) => [...prev, user]);
    return user;
  };

  // Mint a new password-reset link for an existing employee. The backend
  // also emails the link to the employee directly; the raw token is still
  // returned so the UI can show a copyable URL as a fallback channel.
  const generateResetLink = async (userId: string) => {
    if (!token) return null;
    const result = await api<{ token: string; emailed: boolean; sentTo: string }>(
      `/users/${userId}/reset-link`,
      { token, method: 'POST' }
    );
    return result;
  };

  const removeMember = async (id: string) => {
    if (!token) return;
    await api(`/users/${id}`, { token, method: 'DELETE' });
    // User could have been in either list — filter both so the UI reflects
    // the deletion regardless of which tab we were on when it happened.
    setMembers((prev) => prev.filter((m) => m.id !== id));
    setInactiveMembers((prev) => prev.filter((m) => m.id !== id));
  };

  // Soft-delete: keeps the record, blocks login, hides from scheduling.
  // Moves the user from the Active list to the Deactivated list optimistically
  // so the tab counts update immediately without a round-trip.
  const deactivateMember = async (id: string) => {
    if (!token) return;
    await api(`/users/${id}/deactivate`, { token, method: 'POST' });
    setMembers((prev) => {
      const target = prev.find((m) => m.id === id);
      if (target) {
        setInactiveMembers((inactive) => {
          // Avoid duplicates if the inactive list was already loaded and
          // somehow has a stale copy.
          if (inactive.some((u) => u.id === id)) return inactive;
          return [...inactive, { ...target, isActive: false }];
        });
      }
      return prev.filter((m) => m.id !== id);
    });
  };

  const activateMember = async (id: string) => {
    if (!token) return;
    await api(`/users/${id}/activate`, { token, method: 'POST' });
    setInactiveMembers((prev) => {
      const target = prev.find((m) => m.id === id);
      if (target) {
        setMembers((active) => {
          if (active.some((u) => u.id === id)) return active;
          return [...active, { ...target, isActive: true }];
        });
      }
      return prev.filter((m) => m.id !== id);
    });
  };

  const updateMember = async (id: string, data: Partial<User> & { positionIds?: string[]; locationIds?: string[] }) => {
    if (!token) return;
    const updated = await api<User>(`/users/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)));
    setInactiveMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)));
    return updated;
  };

  return {
    members,
    inactiveMembers,
    inactiveLoaded,
    loading,
    fetchMembers,
    fetchInactive,
    addMember,
    removeMember,
    deactivateMember,
    activateMember,
    updateMember,
    generateResetLink,
  };
}
