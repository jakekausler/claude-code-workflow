import { Pencil } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';
import { computeDiff, getDiffStats } from '../../utils/diff.js';
import type { DiffLine } from '../../utils/diff.js';

interface Props {
  execution: ToolExecution;
}

/** Extract the last path segment from a file path. */
function basename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/** Render a single diff line with dual line-number gutters. */
function DiffLineRow({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === 'removed'
      ? 'bg-red-50'
      : line.type === 'added'
        ? 'bg-green-50'
        : '';

  const textClass =
    line.type === 'removed'
      ? 'text-red-800'
      : line.type === 'added'
        ? 'text-green-800'
        : 'text-slate-700';

  const borderClass =
    line.type === 'removed'
      ? 'border-l-3 border-red-300'
      : line.type === 'added'
        ? 'border-l-3 border-green-300'
        : 'border-l-3 border-transparent';

  const prefix = line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' ';

  return (
    <div className={`flex min-w-full ${bgClass} ${borderClass}`}>
      {/* Old line number */}
      <span className="w-10 shrink-0 select-none px-2 text-right text-slate-400 text-xs font-mono">
        {line.oldLineNum ?? ''}
      </span>
      {/* New line number */}
      <span className="w-10 shrink-0 select-none px-2 text-right text-slate-400 text-xs font-mono">
        {line.newLineNum ?? ''}
      </span>
      {/* Prefix (+/-/space) */}
      <span className={`w-5 shrink-0 select-none text-center font-mono text-xs ${textClass}`}>
        {prefix}
      </span>
      {/* Content */}
      <span className={`flex-1 whitespace-pre font-mono text-xs ${textClass}`}>
        {line.content || ' '}
      </span>
    </div>
  );
}

export function EditRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;

  // If neither old nor new string is available, just show the file path
  const hasOld = oldString != null && oldString !== '';
  const hasNew = newString != null && newString !== '';

  // Compute diff when both sides are available
  const diffLines = hasOld && hasNew ? computeDiff(oldString, newString) : null;
  const stats = diffLines ? getDiffStats(diffLines) : null;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 border-b border-slate-200">
        <Pencil className="w-4 h-4 shrink-0 text-slate-500" />
        <span className="truncate font-mono text-xs text-slate-700">
          {filePath ? basename(filePath) : 'Edit'}
        </span>
        {stats && (
          <span className="ml-auto shrink-0 text-xs">
            {stats.added > 0 && (
              <span className="text-green-700 mr-1">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="text-red-700">-{stats.removed}</span>
            )}
          </span>
        )}
      </div>

      {/* Diff content */}
      <div className="overflow-auto max-h-96 bg-white">
        {diffLines ? (
          <div className="inline-block min-w-full">
            {diffLines.map((line, i) => (
              <DiffLineRow key={i} line={line} />
            ))}
            {diffLines.length === 0 && (
              <div className="px-3 py-2 text-slate-400 italic text-xs">
                No changes detected
              </div>
            )}
          </div>
        ) : (
          /* Fallback: show whichever side is available */
          <div className="space-y-0">
            {hasOld && (
              <div className="bg-red-50 border-b border-slate-200">
                <div className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 border-b border-red-200">
                  Removed
                </div>
                <pre className="px-3 py-2 text-xs font-mono text-red-800 whitespace-pre-wrap overflow-x-auto">
                  {oldString}
                </pre>
              </div>
            )}
            {hasNew && (
              <div className="bg-green-50">
                <div className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 border-b border-green-200">
                  Added
                </div>
                <pre className="px-3 py-2 text-xs font-mono text-green-800 whitespace-pre-wrap overflow-x-auto">
                  {newString}
                </pre>
              </div>
            )}
            {!hasOld && !hasNew && (
              <div className="px-3 py-2 text-slate-400 italic text-xs">
                No content
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
