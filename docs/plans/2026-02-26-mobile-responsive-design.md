# Mobile Responsive Sidebar & Drawers Design

**Date**: 2026-02-26
**Status**: Approved

## Problem

The web view's left sidebar is always visible regardless of screen size, wasting space on mobile. Board page drawers open as fixed-width panels that don't adapt to small screens.

## Decisions

- **Breakpoint**: `md` (768px) — standard Tailwind default. Below this = "mobile".
- **State management**: New Zustand store (`sidebar-store.ts`) for sidebar open/close — consistent with existing `drawer-store.ts` pattern.
- **Hamburger location**: In the existing `Header` component, visible only on mobile (`md:hidden`).
- **Nav auto-close**: Tapping a sidebar nav link on mobile auto-closes the sidebar overlay.
- **Drawer dismiss**: Button only (close/back in drawer header). No swipe gestures.

## Design

### 1. Sidebar Store

New file: `store/sidebar-store.ts`

```ts
interface SidebarStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}
```

### 2. Layout Changes (`Layout.tsx`)

- **Desktop (≥ md)**: No change — sidebar renders as fixed `w-64` in flex layout.
- **Mobile (< md)**: Sidebar hidden from flex flow. When `isOpen` is true, renders as full-screen overlay (`fixed inset-0 z-50 bg-slate-900`).

### 3. Header Changes (`Header.tsx`)

- Add hamburger icon (Lucide `Menu`) to left side of header.
- Only visible on mobile: `md:hidden`.
- Calls `toggle()` from sidebar store.

### 4. Sidebar Changes (`Sidebar.tsx`)

- On mobile, each `<Link>` click also calls `close()` from sidebar store.
- Add close button (X icon) in sidebar header area on mobile.

### 5. DetailDrawer Changes (`DetailDrawer.tsx`)

- **Desktop (≥ md)**: No change — right-side panel with `max-w-2xl`.
- **Mobile (< md)**: Full-screen — `fixed inset-0 z-50`. Close/back buttons remain dismiss mechanism.

### 6. Board Auto-Scroll (`BoardLayout.tsx`)

- Skip drawer-width offset logic on mobile (drawer covers full screen, no partial board visible).

## Files Changed

| File | Change |
|------|--------|
| `store/sidebar-store.ts` | New — Zustand store for sidebar state |
| `components/layout/Layout.tsx` | Conditional sidebar rendering by breakpoint |
| `components/layout/Header.tsx` | Add hamburger button (mobile only) |
| `components/layout/Sidebar.tsx` | Auto-close on nav, close button on mobile |
| `components/detail/DetailDrawer.tsx` | Full-screen on mobile |
| `components/board/BoardLayout.tsx` | Skip auto-scroll offset on mobile |
