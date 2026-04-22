'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import clsx from 'clsx';

interface NavItem {
  href?: string;
  labelKey: string;
  icon: React.FC;
  managerOnly?: boolean;
  employeeOnly?: boolean;
  children?: NavItem[];
}

const nav: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.overview', icon: HomeIcon },
  { href: '/dashboard/today', labelKey: 'nav.today', icon: SunIcon, employeeOnly: true },
  {
    labelKey: 'nav.schedule',
    icon: CalendarIcon,
    children: [
      { href: '/dashboard/schedule', labelKey: 'nav.calendar', icon: CalendarIcon },
      { href: '/dashboard/approvals', labelKey: 'nav.approvals', icon: InboxIcon, managerOnly: true },
      { href: '/dashboard/timeoff', labelKey: 'nav.timeoff', icon: ClockIcon },
      { href: '/dashboard/open-shifts', labelKey: 'nav.openShifts', icon: OpenShiftIcon },
      { href: '/dashboard/swaps', labelKey: 'nav.swaps', icon: SwapIcon },
      { href: '/dashboard/schedule/templates', labelKey: 'nav.templates', icon: ClipboardIcon, managerOnly: true },
    ],
  },
  { href: '/dashboard/timeclock', labelKey: 'nav.timeclock', icon: ClockIcon },
  { href: '/dashboard/team', labelKey: 'nav.team', icon: UsersIcon, managerOnly: true },
  { href: '/dashboard/announcements', labelKey: 'nav.announcements', icon: MegaphoneIcon },
  { href: '/dashboard/messages', labelKey: 'nav.messages', icon: ChatIcon },
  { href: '/dashboard/attendance', labelKey: 'nav.attendance', icon: CheckBadgeIcon, managerOnly: true },
  { href: '/dashboard/incidents', labelKey: 'nav.incidents', icon: ExclamationIcon },
  { href: '/dashboard/reports', labelKey: 'nav.reports', icon: ChartIcon, managerOnly: true },
  { href: '/dashboard/audit', labelKey: 'nav.audit', icon: ShieldIcon, managerOnly: true },
  { href: '/dashboard/profile', labelKey: 'nav.profile', icon: UserIcon },
  { href: '/dashboard/settings', labelKey: 'nav.admin', icon: GearIcon, managerOnly: true },
];

interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps = {}) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const t = useT();
  const isManager = user?.role === 'OWNER' || user?.role === 'ADMIN' || user?.role === 'MANAGER';

  // Auto-open the Schedule dropdown if we're on any child page
  const scheduleChildPaths = ['/dashboard/schedule', '/dashboard/approvals', '/dashboard/timeoff', '/dashboard/open-shifts', '/dashboard/swaps', '/dashboard/schedule/templates'];
  const isScheduleActive = scheduleChildPaths.some((p) => pathname.startsWith(p));
  const [scheduleOpen, setScheduleOpen] = useState(isScheduleActive);

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  const renderItem = (item: NavItem) => {
    if (item.managerOnly && !isManager) return null;
    if (item.employeeOnly && isManager) return null;

    // Dropdown parent
    if (item.children) {
      const anyChildActive = item.children.some((c) => c.href && isActive(c.href));
      return (
        <div key={item.labelKey}>
          <button
            onClick={() => setScheduleOpen((v) => !v)}
            className={clsx(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              anyChildActive ? 'text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
            )}
          >
            <item.icon />
            <span className="flex-1 text-left">{t(item.labelKey)}</span>
            <ChevronIcon open={scheduleOpen} />
          </button>
          {scheduleOpen && (
            <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-700 pl-2">
              {item.children.map((child) => {
                if (child.managerOnly && !isManager) return null;
                if (child.employeeOnly && isManager) return null;
                const active = child.href ? isActive(child.href) : false;
                return (
                  <a
                    key={child.href}
                    href={child.href}
                    onClick={onClose}
                    className={clsx(
                      'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                      active ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    )}
                  >
                    <child.icon />
                    {t(child.labelKey)}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Regular item
    const active = item.href ? isActive(item.href) : false;
    return (
      <a
        key={item.href}
        href={item.href}
        onClick={onClose}
        className={clsx(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
          active ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
        )}
      >
        <item.icon />
        {t(item.labelKey)}
      </a>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={onClose}
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          aria-hidden="true"
        />
      )}
      <aside
        className={clsx(
          'flex h-screen w-56 flex-col bg-gray-900 text-white shrink-0',
          'fixed md:static inset-y-0 left-0 z-50 transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
      <div className="px-4 py-4 border-b border-gray-800 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/pelican-logo.png"
          alt="Pelican Shops"
          className="h-9 w-auto shrink-0 rounded bg-white/95 p-1"
        />
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-indigo-400 leading-tight">{t('app.name')}</h1>
          <p className="text-[11px] text-gray-500 leading-tight">{t('app.tagline')}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3 overflow-y-auto">
        {nav.map(renderItem)}
      </nav>

      <div className="border-t border-gray-800 px-4 py-4">
        <p className="text-sm font-medium truncate">{user?.firstName} {user?.lastName}</p>
        <p className="text-xs text-gray-400 truncate">{user?.role}</p>
        <button
          onClick={() => { logout(); window.location.href = '/login'; }}
          className="mt-2 text-xs text-gray-400 hover:text-white transition"
        >
          {t('auth.signOut')}
        </button>
      </div>
      </aside>
    </>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx('h-3.5 w-3.5 transition-transform', open && 'rotate-90')}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  );
}

function OpenShiftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 5.25-4.5 9.75-9 9.75S3 17.25 3 12V5.25l9-2.25 9 2.25V12Z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H6.911a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661Z" />
    </svg>
  );
}

function ExclamationIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}
