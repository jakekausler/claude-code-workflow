import { Bell } from 'lucide-react';

export interface PendingBadgeProps {
  count: number;
  variant?: 'badge' | 'bell';
}

export function PendingBadge({ count, variant = 'badge' }: PendingBadgeProps) {
  if (count === 0) return null;

  if (variant === 'bell') {
    return (
      <span className="relative inline-flex" title={`${count} pending approval(s)`}>
        <Bell size={16} className="text-yellow-400 animate-pulse" />
        <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-yellow-500 text-[10px] font-bold text-black">
          {count}
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-500 px-1.5 text-[10px] font-bold text-black"
      title={`${count} pending approval(s)`}
    >
      {count}
    </span>
  );
}
