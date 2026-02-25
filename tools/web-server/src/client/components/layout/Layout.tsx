import { Sidebar } from './Sidebar.js';
import { Header } from './Header.js';
import { DrawerHost } from '../detail/DrawerHost.js';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
      <DrawerHost />
    </div>
  );
}
