import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, GitBranch, GitFork, X, Settings as SettingsIcon, Download, Users } from 'lucide-react';
import { useSidebarStore } from '../../store/sidebar-store.js';
import { useCurrentUser } from '../../api/hooks.js';
import { can } from '../../utils/permissions.js';

export function Sidebar({ className = '' }: { className?: string }) {
  const location = useLocation();
  const close = useSidebarStore((s) => s.close);
  const { data: me } = useCurrentUser();

  const navItems = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { to: '/board', label: 'Board', icon: Layers, show: true },
    { to: '/graph', label: 'Dependency Graph', icon: GitBranch, show: true },
    { to: '/branches', label: 'Branch Hierarchy', icon: GitFork, show: true },
    { to: '/teams', label: 'Teams', icon: Users, show: can(me, 'settings:teamManagement') },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, show: true },
    { to: '/import', label: 'Import Issues', icon: Download, show: can(me, 'import:trigger') },
  ].filter((item) => item.show);

  return (
    <aside className={`flex w-64 flex-col bg-slate-900 text-white ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
        <h1 className="text-lg font-semibold">Kanban Workflow</h1>
        <button
          onClick={close}
          className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
          aria-label="Close sidebar"
        >
          <X size={18} />
        </button>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              onClick={close}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
