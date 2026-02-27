import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';
import { DrawerHost } from '../detail/DrawerHost.js';
import { useSidebarStore } from '../../store/sidebar-store.js';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const isSidebarOpen = useSidebarStore((s) => s.isOpen);
  const closeSidebar = useSidebarStore((s) => s.close);

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Desktop sidebar — always visible at md+ */}
      <Sidebar className="hidden md:flex" />

      {/* Mobile sidebar overlay — full screen when open */}
      {isSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 md:hidden"
            onClick={closeSidebar}
            aria-hidden="true"
          />
          <Sidebar className="fixed inset-0 z-50 w-full md:hidden" />
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <DrawerHost />
    </div>
  );
}
