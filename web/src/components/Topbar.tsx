import { useState } from 'react';
import { Menu, Bell, Sun, Moon, ChevronDown, LogOut, User as UserIcon, Phone } from 'lucide-react';
import { Menu as HMenu, Transition } from '@headlessui/react';
import { Fragment } from 'react';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import { wsClient } from '@/lib/ws';
import { useSoftphoneStore } from '@/store/softphoneStore';
import { Badge } from './Badge';
import { TenantSwitcher } from './TenantSwitcher';
import { clsx } from 'clsx';

interface TopbarProps {
  onSidebarToggle: () => void;
  darkMode: boolean;
  onDarkModeToggle: () => void;
}

function PresenceDot({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    registered: 'bg-emerald-400',
    registering: 'bg-amber-400 animate-pulse',
    failed: 'bg-red-400',
    unregistered: 'bg-surface-400',
  };
  return (
    <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', colorMap[state] ?? 'bg-surface-400')} />
  );
}

export function Topbar({ onSidebarToggle, darkMode, onDarkModeToggle }: TopbarProps) {
  const { user, logout } = useAuthStore();
  const { registrationState, currentCall, setDialerOpen } = useSoftphoneStore();
  const [notifications] = useState(0);

  const handleLogout = async () => {
    await authApi.logout();
    wsClient.disconnect();
    logout();
  };

  // Defensive: never assume names are present. A user without a first/last name
  // must not be able to crash the shell (this is rendered outside the page-level
  // ErrorBoundary, so a throw here white-screens the whole app).
  const fullName =
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || 'User';
  const initials =
    ((user?.first_name?.[0] ?? '') + (user?.last_name?.[0] ?? '')).toUpperCase() ||
    (user?.email?.[0]?.toUpperCase() ?? 'U');

  return (
    <header className="h-14 flex items-center gap-3 px-4 border-b border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900">
      {/* Sidebar toggle */}
      <button onClick={onSidebarToggle} className="btn-ghost btn-icon text-surface-500">
        <Menu size={18} />
      </button>

      {/* Tenant switcher (superadmin only) */}
      <TenantSwitcher />

      <div className="flex-1" />

      {/* Softphone status chip */}
      <button
        onClick={() => setDialerOpen(true)}
        className={clsx(
          'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors',
          currentCall
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300 animate-ring'
            : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700'
        )}
      >
        <PresenceDot state={registrationState} />
        <Phone size={13} />
        <span className="text-xs">
          {currentCall
            ? currentCall.remoteIdentity
            : registrationState === 'registered'
            ? 'Ready'
            : registrationState === 'registering'
            ? 'Registering…'
            : 'Softphone'}
        </span>
      </button>

      {/* Dark mode */}
      <button onClick={onDarkModeToggle} className="btn-ghost btn-icon text-surface-500">
        {darkMode ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* Notifications */}
      <button className="btn-ghost btn-icon text-surface-500 relative">
        <Bell size={16} />
        {notifications > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-danger text-white text-2xs flex items-center justify-center">
            {notifications}
          </span>
        )}
      </button>

      {/* User menu */}
      <HMenu as="div" className="relative">
        <HMenu.Button className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-700 transition-colors">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
            {initials}
          </div>
          <span className="hidden md:block text-sm font-medium text-surface-700 dark:text-surface-200 max-w-[120px] truncate">
            {fullName}
          </span>
          <ChevronDown size={12} className="text-surface-400" />
        </HMenu.Button>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <HMenu.Items className="absolute right-0 mt-1 w-52 bg-white dark:bg-surface-800 rounded-xl shadow-elevated ring-1 ring-surface-200 dark:ring-surface-700 py-1 z-50 focus:outline-none">
            <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-700">
              <p className="text-sm font-semibold text-surface-900 dark:text-surface-100">{fullName}</p>
              <p className="text-xs text-surface-500">{user?.email}</p>
              <Badge variant="primary" className="mt-1 capitalize">{user?.role}</Badge>
            </div>
            <HMenu.Item>
              {({ active }) => (
                <a
                  href="/settings"
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm',
                    active ? 'bg-surface-50 dark:bg-surface-700 text-surface-900 dark:text-surface-100' : 'text-surface-700 dark:text-surface-300'
                  )}
                >
                  <UserIcon size={14} /> Profile
                </a>
              )}
            </HMenu.Item>
            <HMenu.Item>
              {({ active }) => (
                <button
                  onClick={handleLogout}
                  className={clsx(
                    'flex items-center gap-2 px-4 py-2 text-sm w-full text-left',
                    active ? 'bg-surface-50 dark:bg-surface-700 text-red-600 dark:text-red-400' : 'text-surface-700 dark:text-surface-300'
                  )}
                >
                  <LogOut size={14} /> Sign out
                </button>
              )}
            </HMenu.Item>
          </HMenu.Items>
        </Transition>
      </HMenu>
    </header>
  );
}
