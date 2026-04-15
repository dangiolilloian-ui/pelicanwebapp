'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { User } from '@/types';

export function useTeam() {
  const { token } = useAuth();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // Password is optional now: leaving it blank generates a single-use invite
  // link that the manager can forward to the new employee. The backend
  // returns `inviteToken` when that path is taken.
  const addMember = async (data: { email: string; firstName: string; lastName: string; phone?: string; role?: string; password?: string }) => {
    if (!token) return;
    const user = await api<User & { inviteToken?: string | null }>('/users', {
      token,
      method: 'POST',
      body: JSON.stringify(data),
    });
    setMembers((prev) => [...prev, user]);
    return user;
  };

  // Mint a new password-reset link for an existing employee. Returns the raw
  // token string; the caller builds the URL and decides how to deliver it.
  const generateResetLink = async (userId: string) => {
    if (!token) return null;
    const { token: resetToken } = await api<{ token: string }>(`/users/${userId}/reset-link`, {
      token,
      method: 'POST',
    });
    return resetToken;
  };

  const removeMember = async (id: string) => {
    if (!token) return;
    await api(`/users/${id}`, { token, method: 'DELETE' });
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMember = async (id: string, data: Partial<User> & { positionIds?: string[]; locationIds?: string[] }) => {
    if (!token) return;
    const updated = await api<User>(`/users/${id}`, {
      token,
      method: 'PUT',
      body: JSON.stringify(data),
    });
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)));
    return updated;
  };

  return { members, loading, fetchMembers, addMember, removeMember, updateMember, generateResetLink };
}
