import { useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/** Build breadcrumb segments from the current path. */
function buildBreadcrumbs(pathname: string): { label: string; to: string }[] {
  if (pathname === '/') return [{ label: 'Dashboard', to: '/' }];

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { label: string; to: string }[] = [
    { label: 'Home', to: '/' },
  ];

  let path = '';
  for (const segment of segments) {
    path += `/${segment}`;
    crumbs.push({ label: segment, to: path });
  }
  return crumbs;
}

export function Header() {
  const location = useLocation();
  const crumbs = buildBreadcrumbs(location.pathname);

  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3">
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
