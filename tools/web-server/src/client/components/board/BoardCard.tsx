import { PendingBadge } from '../interaction/PendingBadge.js';

interface Badge {
  label: string;
  color: string;
}

interface BoardCardProps {
  id: string;
  title: string;
  subtitle?: string;
  badges?: Badge[];
  progress?: number;
  statusDot?: string;
  isSelected?: boolean;
  onClick: () => void;
  pendingCount?: number;
}

export type { Badge };

export function BoardCard({
  id,
  title,
  subtitle,
  badges,
  progress,
  statusDot,
  isSelected,
  onClick,
  pendingCount = 0,
}: BoardCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View ${title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer rounded-lg border bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {statusDot && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: statusDot }}
              />
            )}
            <span className="text-xs font-medium text-slate-500">{id}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm font-medium text-slate-900 truncate">{title}</p>
            {pendingCount > 0 && <PendingBadge count={pendingCount} />}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
        </div>
      </div>
      {badges && badges.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge, i) => (
            <span
              key={`${badge.label}-${i}`}
              className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: badge.color + '20', color: badge.color }}
            >
              {badge.label}
            </span>
          ))}
        </div>
      )}
      {progress !== undefined && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200"
        >
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}
    </div>
  );
}
