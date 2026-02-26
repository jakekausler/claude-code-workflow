import { ChevronDown } from 'lucide-react';

export interface SessionHistoryEntry {
  sessionId: string;
  phase: string;
  startedAt: string;
  endedAt: string | null;
  isCurrent: boolean;
}

interface SessionHistoryDropdownProps {
  sessions: SessionHistoryEntry[];
  selectedSessionId: string;
  onSelect: (sessionId: string) => void;
}

export function SessionHistoryDropdown({
  sessions,
  selectedSessionId,
  onSelect,
}: SessionHistoryDropdownProps) {
  if (sessions.length <= 1) {
    // Single session — show label only, no dropdown
    const session = sessions[0];
    if (!session) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600">
        <span className="font-medium">{session.phase}</span>
        <span className="text-slate-400">&mdash;</span>
        <span className="text-xs text-slate-400">{formatDate(session.startedAt)}</span>
        {session.isCurrent ? <LiveBadge /> : <ReadOnlyBadge />}
      </div>
    );
  }

  return (
    <div className="relative px-3 py-2">
      <select
        value={selectedSessionId}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full appearance-none rounded-md border border-slate-300 bg-white px-3 py-1.5 pr-8 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {sessions.map((session) => (
          <option key={session.sessionId} value={session.sessionId}>
            {session.phase} — {formatDate(session.startedAt)}
            {session.isCurrent ? ' (Live)' : ' (Read Only)'}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      Live
    </span>
  );
}

function ReadOnlyBadge() {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      Read Only
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
