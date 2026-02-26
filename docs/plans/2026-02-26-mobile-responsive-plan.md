# Mobile Responsive Sidebar & Drawers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the left sidebar hidden on mobile with a hamburger toggle, and make board drawers full-screen on mobile.

**Architecture:** New Zustand sidebar store for open/close state. Tailwind responsive classes (`md:` prefix) to conditionally show/hide sidebar and resize drawers. No new dependencies needed — Lucide already has `Menu` and `X` icons, Zustand is already in use.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 3.4, Lucide React

---

### Task 1: Create Sidebar Store

**Files:**
- Create: `tools/web-server/src/client/store/sidebar-store.ts`

**Step 1: Write the store**

```ts
import { create } from 'zustand';

interface SidebarState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
```

Reference `tools/web-server/src/client/store/drawer-store.ts` for the identical pattern.

**Step 2: Commit**

```bash
git add tools/web-server/src/client/store/sidebar-store.ts
git commit -m "feat(web-server): add sidebar Zustand store for mobile toggle"
```

---

### Task 2: Update Sidebar Component for Mobile

**Files:**
- Modify: `tools/web-server/src/client/components/layout/Sidebar.tsx`

**Step 1: Update the Sidebar component**

The Sidebar needs two changes:
1. Accept an `onNavigate` callback prop so Layout can pass `close()` for mobile nav clicks
2. Add a close button (X) visible only on mobile in the header area

Replace the entire file content with:

```tsx
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
```

Key changes from original (lines 1-41):
- Import `X` from lucide-react and `useSidebarStore`
- Accept `className` prop for Layout to control visibility
- Add close button with `md:hidden` (only shows on mobile)
- Add `onClick={close}` to every `<Link>` — on desktop this is a no-op (sidebar is always open, `close()` sets `isOpen: false` which doesn't affect desktop rendering)

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/layout/Sidebar.tsx
git commit -m "feat(web-server): add mobile close button and nav auto-close to Sidebar"
```

---

### Task 3: Update Header with Hamburger Button

**Files:**
- Modify: `tools/web-server/src/client/components/layout/Header.tsx`

**Step 1: Add hamburger button**

Add the `Menu` icon import and sidebar store, then insert a hamburger button before the breadcrumb nav. The button is only visible on mobile (`md:hidden`).

At the top of the file, change the imports:

```tsx
import { useLocation, Link } from 'react-router-dom';
import { ChevronRight, Menu } from 'lucide-react';
import { useSidebarStore } from '../../store/sidebar-store.js';
```

Then replace the `Header` function (lines 35-56) with:

```tsx
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
```

Key changes:
- Import `Menu` from lucide and `useSidebarStore`
- Header becomes a flex container with `items-center gap-3`
- Hamburger button with `md:hidden` placed before breadcrumb nav
- Adjusted padding: `px-4 md:px-6` for tighter mobile spacing

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/layout/Header.tsx
git commit -m "feat(web-server): add hamburger menu button to Header for mobile"
```

---

### Task 4: Update Layout for Responsive Sidebar

**Files:**
- Modify: `tools/web-server/src/client/components/layout/Layout.tsx`

**Step 1: Update Layout component**

Replace the entire file with:

```tsx
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
```

Key changes from original (lines 1-20):
- Import `useSidebarStore`
- Desktop sidebar gets `className="hidden md:flex"` — hidden below 768px, flex at 768px+
- Mobile sidebar is conditionally rendered when `isSidebarOpen` is true, with:
  - Backdrop overlay (`fixed inset-0 z-40 bg-black/20 md:hidden`)
  - Full-screen sidebar (`fixed inset-0 z-50 w-full md:hidden`)
- Both mobile elements have `md:hidden` as safety net

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/layout/Layout.tsx
git commit -m "feat(web-server): responsive sidebar layout with mobile overlay"
```

---

### Task 5: Make DetailDrawer Full-Screen on Mobile

**Files:**
- Modify: `tools/web-server/src/client/components/detail/DetailDrawer.tsx`

**Step 1: Update the panel class**

In `DetailDrawer.tsx`, change the panel div (line 42) from:

```tsx
className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-xl"
```

to:

```tsx
className="fixed inset-0 z-50 flex flex-col bg-white shadow-xl md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-2xl md:border-l md:border-slate-200"
```

Explanation of the responsive approach:
- **Mobile (default)**: `fixed inset-0` — covers full viewport. No border-l (no visible edge since it's full screen).
- **Desktop (md+)**: `md:inset-y-0 md:left-auto md:right-0` restores right-side panel positioning. `md:w-full md:max-w-2xl` restores the 672px max width. `md:border-l md:border-slate-200` restores the left border.

The key is that `inset-0` (shorthand for `top:0; right:0; bottom:0; left:0`) at mobile makes it full-screen, then at `md:` we override `left` back to `auto` so it only anchors to the right.

**Step 2: Hide backdrop on mobile**

Since the drawer is full-screen on mobile, the backdrop is unnecessary (nothing visible behind it). Change the backdrop div (line 36) from:

```tsx
className="fixed inset-0 z-40 bg-black/20 transition-opacity"
```

to:

```tsx
className="fixed inset-0 z-40 bg-black/20 transition-opacity hidden md:block"
```

This hides the backdrop on mobile (no need for a semi-transparent overlay behind a full-screen panel) and shows it only on desktop.

**Step 3: Commit**

```bash
git add tools/web-server/src/client/components/detail/DetailDrawer.tsx
git commit -m "feat(web-server): make DetailDrawer full-screen on mobile"
```

---

### Task 6: Skip Board Auto-Scroll on Mobile

**Files:**
- Modify: `tools/web-server/src/client/components/board/BoardLayout.tsx`

**Step 1: Add viewport width check**

In the `useEffect` for auto-scroll (lines 16-32), add an early return if the viewport is below the `md` breakpoint. The scroll offset logic is meaningless when the drawer covers the full screen.

Change the useEffect to:

```tsx
useEffect(() => {
  if (selectedColumnIndex == null || !gridRef.current) return;

  // On mobile, drawer is full-screen — no need to scroll board
  const isMobile = window.innerWidth < 768;
  if (isMobile) return;

  const grid = gridRef.current;
  const columns = grid.children;
  if (selectedColumnIndex >= columns.length) return;

  const column = columns[selectedColumnIndex] as HTMLElement;
  const drawerWidth = 672; // max-w-2xl = 42rem = 672px
  const padding = 16;

  // Scroll so column's right edge is at (viewport width - drawer width - padding)
  const targetScrollLeft =
    column.offsetLeft + column.offsetWidth - (grid.clientWidth - drawerWidth - padding);

  grid.scrollTo({ left: Math.max(0, targetScrollLeft), behavior: 'smooth' });
}, [selectedColumnIndex]);
```

Only change: added `window.innerWidth < 768` check with early return after the existing null checks.

**Step 2: Commit**

```bash
git add tools/web-server/src/client/components/board/BoardLayout.tsx
git commit -m "feat(web-server): skip board auto-scroll on mobile viewports"
```

---

### Task 7: Verify

**Step 1: Run verification**

```bash
cd tools/web-server && npm run verify
```

Expected: build passes, all tests pass, no lint errors.

**Step 2: Fix any issues**

If any tests or type checks fail, fix them before proceeding.

**Step 3: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(web-server): address verification issues from mobile responsive changes"
```
