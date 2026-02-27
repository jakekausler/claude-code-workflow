/**
 * Lightweight SSE signal from server indicating a session file changed.
 * The client responds by re-fetching the full session data.
 * Matches devtools' FileChangeEvent pattern.
 */
export interface SSESessionUpdate {
  projectId: string;
  sessionId: string;
  type: 'session-change' | 'subagent-change';
}
