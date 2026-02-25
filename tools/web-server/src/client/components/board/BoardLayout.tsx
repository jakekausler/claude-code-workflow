import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface BoardLayoutProps {
  children: ReactNode;
  isLoading: boolean;
  error: Error | null;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export function BoardLayout({ children, isLoading, error, emptyMessage, isEmpty }: BoardLayoutProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
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
    <div className="grid auto-cols-[280px] grid-flow-col gap-4 overflow-x-auto pb-4">
      {children}
    </div>
  );
}
