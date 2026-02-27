import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import type { SessionMapEntry } from '../../store/board-store.js';
import { SessionStatusIndicator } from '../board/SessionStatusIndicator.js';
import { formatDuration } from '../stage/LiveSessionSection.js';

export interface ActiveSessionsListProps {
  sessions: Map<string, SessionMapEntry>;
}

/**
 * Dashboard widget that shows currently active Claude Code sessions.
 *
 * Gate component: the outer function returns a static "no active sessions"
 * message or delegates to ActiveSessionsListContent which uses hooks for
 * the live timer. This avoids hooks in the early-return path, keeping
 * the component testable by direct function call.
 */
export function ActiveSessionsList({ sessions }: ActiveSessionsListProps) {
  if (sessions.size === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Monitor size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Active Sessions</h2>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">0</span>
        </div>
        <p className="text-sm text-slate-400">No active sessions</p>
      </div>
    );
  }

  return <ActiveSessionsListContent sessions={sessions} />;
}

function ActiveSessionsListContent({ sessions }: ActiveSessionsListProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 10_000);

    return () => clearInterval(interval);
  }, []);

  const entries = Array.from(sessions.entries());

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Monitor size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-700">Active Sessions</h2>
        <span className="ml-auto rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          {sessions.size}
        </span>
      </div>
      <div className="space-y-2">
        {entries.map(([stageId, entry]) => {
          const elapsed = now - entry.spawnedAt;
          return (
            <Link
              key={stageId}
              to={`/stages/${encodeURIComponent(stageId)}`}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-slate-50"
            >
              <SessionStatusIndicator status={entry} compact />
              <span className="truncate font-medium text-slate-700">{stageId}</span>
              <span className="ml-auto shrink-0 tabular-nums text-slate-400">
                {formatDuration(elapsed)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
