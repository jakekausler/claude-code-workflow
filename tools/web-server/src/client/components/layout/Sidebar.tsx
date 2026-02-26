import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, GitBranch, X } from 'lucide-react';
import { useSidebarStore } from '../../store/sidebar-store.js';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/board', label: 'Board', icon: Layers },
  { to: '/graph', label: 'Dependency Graph', icon: GitBranch },
];

export function Sidebar({ className = '' }: { className?: string }) {
  const location = useLocation();
  const close = useSidebarStore((s) => s.close);

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
