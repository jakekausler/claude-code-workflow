import { useState } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  Pencil,
  FilePlus,
  TerminalSquare,
  FolderSearch,
  Search,
  Zap,
  Wrench,
} from 'lucide-react';
import { generateToolSummary, formatDuration } from '../../../utils/session-formatters.js';
import { getToolRenderer } from '../../tools/index.js';
import type { ToolExecution } from '../../../types/session.js';

interface Props {
  execution: ToolExecution;
}

const toolIcons: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: Pencil,
  Write: FilePlus,
  Bash: TerminalSquare,
  Glob: FolderSearch,
  Grep: Search,
  Skill: Zap,
};

export function LinkedToolItem({ execution }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { toolName, input, result, durationMs, isOrphaned } = execution;

  const Icon = toolIcons[toolName] || Wrench;
  const summary = generateToolSummary(toolName, input);
  const isError = result?.isError ?? false;
  const ToolRenderer = getToolRenderer(toolName);

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 ${
        isError
          ? 'border-red-300 bg-red-50/30'
          : isOrphaned
            ? 'border-amber-300 bg-amber-50/30'
            : 'border-slate-200 bg-white'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <Icon className={`w-4 h-4 flex-shrink-0 ${isError ? 'text-red-500' : 'text-slate-500'}`} />
        <span className="font-medium text-slate-700 text-xs">{toolName}</span>
        <span className="text-xs text-slate-500 truncate flex-1 text-left">{summary}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {durationMs != null && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatDuration(durationMs)}
            </span>
          )}
          {isError ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : result ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : null}
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-200">
          <ToolRenderer execution={execution} />
        </div>
      )}
    </div>
  );
}
