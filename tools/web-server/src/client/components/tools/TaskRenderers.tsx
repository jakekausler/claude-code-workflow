import { CheckSquare, RefreshCw, List, Eye } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type TaskStatus = string;

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  done: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  blocked: 'bg-amber-100 text-amber-700',
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const cls = STATUS_STYLES[status?.toLowerCase()] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Extract the previous task status from a TaskUpdate result content string.
 *
 * When the TaskUpdate tool returns the prior task state as JSON (e.g.
 * `{"id":"42","status":"pending",...}`), this function pulls out the
 * `status` field so the renderer can display a transition arrow.
 *
 * Returns `null` if the content is absent, unparseable, or has no `status`.
 */
export function extractPreviousStatus(content: string | null | undefined): string | null {
  if (!content) return null;
  const parsed = tryParseJson(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const status = obj.status;
    if (typeof status === 'string' && status.length > 0) return status;
  }
  return null;
}

// ---------------------------------------------------------------------------
// TaskCreate
// ---------------------------------------------------------------------------

export function TaskCreateRenderer({ execution }: Props) {
  const { input } = execution;
  const subject = (input.subject as string) ?? '';
  const description = (input.description as string) ?? '';

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <CheckSquare className="w-4 h-4 shrink-0 text-blue-500" />
        <span className="text-xs font-medium text-slate-800">{subject || 'New task'}</span>
        <StatusBadge status="pending" />
      </div>
      {description && (
        <div className="text-xs text-slate-500 pl-6 italic">
          {truncate(description, 200)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskUpdate
// ---------------------------------------------------------------------------

interface UpdateField {
  label: string;
  value: string;
}

export function TaskUpdateRenderer({ execution }: Props) {
  const { input } = execution;
  const taskId = (input.taskId as string) ?? (input.task_id as string) ?? '';
  const newStatus = input.status as string | undefined;
  const newSubject = input.subject as string | undefined;

  // Attempt to read the previous status from the result content.
  const resultContent = extractResultContent(execution.result);
  const previousStatus = extractPreviousStatus(resultContent);

  // Show a transition when: both old and new status are known and they differ.
  const showTransition =
    newStatus != null &&
    previousStatus != null &&
    previousStatus.toLowerCase() !== newStatus.toLowerCase();

  const fields: UpdateField[] = [];
  if (newSubject) fields.push({ label: 'subject', value: newSubject });

  // Collect any other scalar updates besides taskId / status / subject
  const SKIP = new Set(['taskId', 'task_id', 'status', 'subject']);
  for (const [k, v] of Object.entries(input)) {
    if (SKIP.has(k)) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      fields.push({ label: k, value: String(v) });
    }
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <RefreshCw className="w-4 h-4 shrink-0 text-amber-500" />
        <span className="text-xs font-medium text-slate-700">
          Task {taskId ? `#${taskId}` : ''}
        </span>
        {showTransition ? (
          <>
            <StatusBadge status={previousStatus!} />
            <span className="text-slate-400 text-xs">&rarr;</span>
            <StatusBadge status={newStatus!} />
          </>
        ) : (
          newStatus && <StatusBadge status={newStatus} />
        )}
      </div>
      {fields.length > 0 && (
        <div className="pl-6 space-y-1">
          {fields.map((f) => (
            <div key={f.label} className="flex gap-1 text-xs">
              <span className="text-slate-400 font-mono">{f.label}:</span>
              <span className="text-slate-700">{truncate(f.value, 100)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskList
// ---------------------------------------------------------------------------

interface TaskItem {
  id?: string | number;
  subject?: string;
  title?: string;
  status?: string;
}

function parseTaskList(content: string): TaskItem[] | null {
  const parsed = tryParseJson(content);
  if (Array.isArray(parsed)) {
    return parsed as TaskItem[];
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // Common wrapper shapes: { tasks: [...] } or { items: [...] }
    const arr = obj.tasks ?? obj.items ?? obj.data;
    if (Array.isArray(arr)) return arr as TaskItem[];
  }
  return null;
}

export function TaskListRenderer({ execution }: Props) {
  const content = extractResultContent(execution.result);
  const isError = execution.result?.isError ?? false;

  const tasks = content ? parseTaskList(content) : null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <List className="w-4 h-4 shrink-0 text-slate-500" />
        <span className="text-xs font-medium text-slate-700">
          {tasks ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''}` : 'Task list'}
        </span>
      </div>

      {tasks ? (
        <div className="pl-6 space-y-1">
          {tasks.map((t, i) => {
            const id = t.id != null ? String(t.id) : null;
            const label = t.subject ?? t.title ?? `Task ${i + 1}`;
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                {id && <span className="text-slate-400 font-mono">#{id}</span>}
                <span className="text-slate-700 flex-1">{truncate(label, 80)}</span>
                {t.status && <StatusBadge status={t.status} />}
              </div>
            );
          })}
        </div>
      ) : content ? (
        <pre
          className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto ${
            isError
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-slate-50 text-slate-800'
          }`}
        >
          {content}
        </pre>
      ) : (
        <div className="text-xs text-slate-400 italic pl-6">No tasks found.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskGet
// ---------------------------------------------------------------------------

interface TaskDetail {
  id?: string | number;
  subject?: string;
  title?: string;
  description?: string;
  status?: string;
  blockedBy?: unknown[];
  blocks?: unknown[];
}

function parseTaskDetail(content: string): TaskDetail | null {
  const parsed = tryParseJson(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as TaskDetail;
  }
  return null;
}

export function TaskGetRenderer({ execution }: Props) {
  const { input } = execution;
  const taskIdInput = (input.taskId as string) ?? (input.task_id as string) ?? '';
  const content = extractResultContent(execution.result);
  const isError = execution.result?.isError ?? false;

  const detail = content ? parseTaskDetail(content) : null;

  const subject = detail?.subject ?? detail?.title ?? '';
  const description = detail?.description ?? '';
  const status = detail?.status ?? '';
  const blockedBy = Array.isArray(detail?.blockedBy) ? detail!.blockedBy : [];
  const blocks = Array.isArray(detail?.blocks) ? detail!.blocks : [];

  const displayId = detail?.id != null ? String(detail.id) : taskIdInput;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Eye className="w-4 h-4 shrink-0 text-slate-500" />
        <span className="text-xs font-medium text-slate-800">
          {displayId ? `Task #${displayId}` : 'Task details'}
        </span>
        {status && <StatusBadge status={status} />}
      </div>

      {detail ? (
        <div className="pl-6 space-y-1.5">
          {subject && (
            <div className="text-xs font-semibold text-slate-800">{subject}</div>
          )}
          {description && (
            <div className="text-xs text-slate-500 italic">{truncate(description, 300)}</div>
          )}
          {blockedBy.length > 0 && (
            <div className="text-xs text-slate-500">
              <span className="text-slate-400">blocked by:</span>{' '}
              {blockedBy.map((b) => (typeof b === 'object' ? JSON.stringify(b) : String(b))).join(', ')}
            </div>
          )}
          {blocks.length > 0 && (
            <div className="text-xs text-slate-500">
              <span className="text-slate-400">blocks:</span>{' '}
              {blocks.map((b) => (typeof b === 'object' ? JSON.stringify(b) : String(b))).join(', ')}
            </div>
          )}
        </div>
      ) : content ? (
        <pre
          className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto ${
            isError
              ? 'bg-red-50 text-red-800 border border-red-200'
              : 'bg-slate-50 text-slate-800'
          }`}
        >
          {content}
        </pre>
      ) : (
        <div className="text-xs text-slate-400 italic pl-6">No task data returned.</div>
      )}
    </div>
  );
}
