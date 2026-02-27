import type { ReactNode } from 'react';

interface BoardColumnProps {
  title: string;
  color: string;
  count: number;
  children: ReactNode;
}

export function BoardColumn({ title, color, count, children }: BoardColumnProps) {
  return (
    <div className="flex flex-col rounded-lg bg-slate-100 min-h-0">
      <div className="sticky top-0 z-10 rounded-t-lg bg-slate-100 px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
          </div>
          <span
            aria-label={`${count} items`}
            className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
          >
            {count}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {count === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">No items</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
