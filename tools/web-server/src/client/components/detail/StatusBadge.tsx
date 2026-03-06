import { statusColor, columnColor, slugToTitle } from '../../utils/formatters.js';

interface StatusBadgeProps {
  status: string;
  type: 'epic' | 'ticket' | 'stage';
  /** For stages, the kanban_column value — used for pipeline-specific colors */
  kanbanColumn?: string;
}

export function StatusBadge({ status, type, kanbanColumn }: StatusBadgeProps) {
  const color =
    type === 'stage' && kanbanColumn ? columnColor(kanbanColumn) : statusColor(status);

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color + '20', color }}
    >
      {slugToTitle(status)}
    </span>
  );
}
