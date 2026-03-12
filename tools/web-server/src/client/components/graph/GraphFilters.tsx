import type { EpicListItem } from '../../api/hooks.js';

interface GraphFiltersProps {
  epicFilter: string;
  setEpicFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  depTypeFilter: string;
  setDepTypeFilter: (value: string) => void;
  epics: EpicListItem[];
  depTypes: string[];
}

export function GraphFilters({
  epicFilter,
  setEpicFilter,
  statusFilter,
  setStatusFilter,
  depTypeFilter,
  setDepTypeFilter,
  epics,
  depTypes,
}: GraphFiltersProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3">
      {/* Epic filter */}
      <select
        value={epicFilter}
        onChange={(e) => setEpicFilter(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
      >
        <option value="">All Epics</option>
        {epics.map((ep) => (
          <option key={ep.id} value={ep.id}>
            {ep.id} — {ep.title}
          </option>
        ))}
      </select>

      {/* Status filter */}
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
      >
        <option value="">All statuses</option>
        <option value="in_progress">In Progress</option>
        <option value="blocked">Blocked</option>
        <option value="completed">Completed</option>
      </select>

      {/* Dependency type filter */}
      <select
        value={depTypeFilter}
        onChange={(e) => setDepTypeFilter(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
      >
        <option value="">All types</option>
        {depTypes.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
