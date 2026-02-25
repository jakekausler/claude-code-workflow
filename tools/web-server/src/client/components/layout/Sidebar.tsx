import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Layers, GitBranch } from 'lucide-react';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/epics', label: 'Epics', icon: Layers },
  { to: '/graph', label: 'Dependency Graph', icon: GitBranch },
];

export function Sidebar() {
  const location = useLocation();

  return (
    <aside className="flex w-64 flex-col bg-slate-900 text-white">
      <div className="border-b border-slate-700 px-6 py-4">
        <h1 className="text-lg font-semibold">Kanban Workflow</h1>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive =
            to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
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
