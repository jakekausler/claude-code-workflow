import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Menu } from 'lucide-react';
import { useSidebarStore } from '../../store/sidebar-store.js';

/**
 * Known route segment labels. Dynamic segments (IDs) are left as-is since
 * we don't have API data in the header. The board pages provide their own
 * contextual titles via page headers.
 */
const SEGMENT_LABELS: Record<string, string> = {
  board: 'Board',
  epics: 'Epics',
  tickets: 'Tickets',
  stages: 'Stages',
  sessions: 'Sessions',
  graph: 'Dependency Graph',
};

function buildBreadcrumbs(pathname: string): { label: string; to: string }[] {
  if (pathname === '/') return [{ label: 'Dashboard', to: '/' }];

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; to: string }[] = [
    { label: 'Dashboard', to: '/' },
  ];

  let path = '';
  for (const segment of segments) {
    path += `/${segment}`;
    const label = SEGMENT_LABELS[segment] ?? segment;
    crumbs.push({ label, to: path });
  }
  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);
  const toggleSidebar = useSidebarStore((s) => s.toggle);

  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
      <button
        onClick={toggleSidebar}
        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 md:hidden"
        aria-label="Toggle sidebar"
      >
        <Menu size={20} />
      </button>
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-slate-600">
        {crumbs.map((crumb, i) => (
          <span key={crumb.to} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-slate-400" />}
            {i === crumbs.length - 1 ? (
              <span className="font-medium text-slate-900">{crumb.label}</span>
            ) : (
              <Link to={crumb.to} className="hover:text-slate-900">
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>
    </header>
  );
}
