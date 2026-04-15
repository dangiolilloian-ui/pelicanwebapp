import { create } from 'zustand';
import type { User, AuthResponse } from '@/types';
import { api } from './api';

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  // Resolves with { requires2fa: true } when the server needs a TOTP code.
  // Caller must re-invoke with the code supplied.
  login: (email: string, password: string, totp?: string) => Promise<{ requires2fa?: boolean }>;
  register: (data: { organizationName: string; firstName: string; lastName: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
  loadSession: () => Promise<void>;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isLoading: true,

  login: async (email, password, totp) => {
    const res = await api<AuthResponse & { requires2fa?: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(totp ? { totp } : {}) }),
    });
    if (res.requires2fa) {
      // Don't persist anything yet — caller prompts for the code and
      // re-submits.
      return { requires2fa: true };
    }
    localStorage.setItem('token', res.token);
    set({ token: res.token, user: res.user });
    return {};
  },

  register: async (data) => {
    const res = await api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    localStorage.setItem('token', res.token);
    set({ token: res.token, user: res.user });
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ token: null, user: null });
  },

  loadSession: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isLoading: false });
      return;
    }
    try {
      const user = await api<User>('/auth/me', { token });
      set({ token, user, isLoading: false });
    } catch {
      localStorage.removeItem('token');
      set({ token: null, user: null, isLoading: false });
    }
  },
}));
