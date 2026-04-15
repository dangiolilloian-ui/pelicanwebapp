'use client';

import { useState } from 'react';
import { AuthGuard } from '@/components/AuthGuard';
import { Sidebar } from '@/components/Sidebar';
import { NotificationBell } from '@/components/NotificationBell';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LocaleToggle } from '@/components/LocaleToggle';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden">
        <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 py-2">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="md:hidden p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
              </svg>
            </button>
            <span className="md:hidden text-sm font-bold text-indigo-600 dark:text-indigo-400">Pelican</span>
            <div className="hidden md:block" />
            <div className="flex items-center gap-2">
              <LocaleToggle />
              <ThemeToggle />
              <NotificationBell />
            </div>
          </div>
          <main className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-950 min-h-0">{children}</main>
        </div>
      </div>
    </AuthGuard>
  );
}
