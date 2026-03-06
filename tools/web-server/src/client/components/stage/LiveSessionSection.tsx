import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { SessionMapEntry } from '../../store/board-store.js';
import { SessionStatusIndicator } from '../board/SessionStatusIndicator.js';

export interface LiveSessionSectionProps {
  stageId: string;
  sessionStatus: SessionMapEntry | null;
  /** Optional projectId for building the session page link. */
  projectId?: string;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * - Under 60s: "Xs"
 * - Under 1h: "Xm Ys"
 * - 1h+: "Xh Ym"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Gate component: returns null for inactive/missing sessions, delegates
 * to LiveSessionContent for active sessions. This avoids hooks in the
 * null-return path, keeping it testable without a React render tree.
 */
export function LiveSessionSection({ stageId, sessionStatus, projectId }: LiveSessionSectionProps) {
  if (!sessionStatus || sessionStatus.status === 'ended') {
    return null;
  }

  return (
    <LiveSessionContent stageId={stageId} sessionStatus={sessionStatus} projectId={projectId} />
  );
}

/** Props for the inner component — session is guaranteed non-null and active. */
interface LiveSessionContentProps {
  stageId: string;
  sessionStatus: SessionMapEntry;
  projectId?: string;
}

function LiveSessionContent({ stageId, sessionStatus, projectId }: LiveSessionContentProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const elapsed = now - sessionStatus.spawnedAt;
  const truncatedId = sessionStatus.sessionId.slice(0, 12);

  return (
    <div
      data-testid="live-session-section"
      className="rounded-lg border border-zinc-700 bg-zinc-800 p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-zinc-200">Live Session</h4>
          <SessionStatusIndicator status={sessionStatus} />
        </div>
        <span
          data-testid="live-session-duration"
          className="text-xs tabular-nums text-zinc-400"
        >
          {formatDuration(elapsed)}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <code className="text-xs text-zinc-400">{truncatedId}</code>
        {projectId ? (
          <Link
            to={`/sessions/${encodeURIComponent(projectId)}/${sessionStatus.sessionId}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            View Session
            <ExternalLink size={12} />
          </Link>
        ) : (
          <span className="text-xs text-zinc-500">
            Session {truncatedId}
          </span>
        )}
      </div>
    </div>
  );
}
