import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface BoardLayoutProps {
  children: ReactNode;
  isLoading: boolean;
  error: Error | null;
  emptyMessage?: string;
  isEmpty?: boolean;
  selectedColumnIndex?: number | null;
}

export function BoardLayout({ children, isLoading, error, emptyMessage, isEmpty, selectedColumnIndex }: BoardLayoutProps) {
  const gridRef = useRef<HTMLDivElement>(null);

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

  if (isLoading) {
    return (
      <div role="status" className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-600">
        <AlertCircle size={20} />
        <span className="ml-2 text-sm">Failed to load data: {error.message}</span>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        {emptyMessage ?? 'No data available.'}
      </div>
    );
  }

  return (
    <div ref={gridRef} className="grid auto-cols-[280px] grid-flow-col gap-4 overflow-x-auto pb-4">
      {children}
    </div>
  );
}
