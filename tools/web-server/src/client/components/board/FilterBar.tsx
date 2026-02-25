import { useRepos, useEpics, useTickets } from '../../api/hooks.js';
import { useBoardStore } from '../../store/board-store.js';

const selectClass =
  'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export function FilterBar() {
  const {
    selectedRepo,
    selectedEpic,
    selectedTicket,
    setSelectedRepo,
    setSelectedEpic,
    setSelectedTicket,
  } = useBoardStore();

  const { data: repos } = useRepos();
  const { data: epics } = useEpics();
  const { data: tickets } = useTickets(
    selectedEpic ? { epic: selectedEpic } : undefined,
  );

  return (
    <div className="mb-4 flex items-center gap-3">
      {/* Repo Filter — always shown */}
      <select
        value={selectedRepo ?? ''}
        onChange={(e) => setSelectedRepo(e.target.value || null)}
        className={selectClass}
      >
        <option value="">All Repos</option>
        {repos?.map((r) => (
          <option key={r.id} value={r.name}>
            {r.name}
          </option>
        ))}
      </select>

      {/* Epic Filter */}
      <select
        value={selectedEpic ?? ''}
        onChange={(e) => setSelectedEpic(e.target.value || null)}
        className={selectClass}
      >
        <option value="">All Epics</option>
        {epics?.map((e) => (
          <option key={e.id} value={e.id}>
            {e.title || e.id}
          </option>
        ))}
      </select>

      {/* Ticket Filter — scoped to selected epic */}
      <select
        value={selectedTicket ?? ''}
        onChange={(e) => setSelectedTicket(e.target.value || null)}
        className={selectClass}
      >
        <option value="">All Tickets</option>
        {tickets?.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title || t.id}
          </option>
        ))}
      </select>
    </div>
  );
}
