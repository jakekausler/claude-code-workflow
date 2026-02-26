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
  BookOpen,
} from 'lucide-react';
import {
  generateToolSummary,
  formatDuration,
  formatTokensCompact,
} from '../../../utils/session-formatters.js';
import { getToolRenderer } from '../../tools/index.js';
import { useSessionViewStore } from '../../../store/session-store.js';
import type { LinkedToolItemData } from '../../../types/groups.js';
import type { ToolExecution } from '../../../types/session.js';

interface Props {
  tool: LinkedToolItemData;
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

/**
 * Adapt a LinkedToolItemData to the ToolExecution shape expected by tool renderers.
 */
function toToolExecution(tool: LinkedToolItemData): ToolExecution {
  return {
    toolCallId: tool.id,
    toolName: tool.name,
    input: tool.input,
    result: tool.result
      ? {
          toolUseId: tool.id,
          content: tool.result.content,
          isError: tool.result.isError,
        }
      : undefined,
    startTime: tool.startTime,
    endTime: tool.endTime,
    durationMs: tool.durationMs,
    isOrphaned: tool.isOrphaned,
  };
}

/**
 * Renders a LinkedToolItemData as a collapsible card.
 *
 * Collapsed row: chevron, tool icon, tool name, summary, token count, duration, status indicator.
 * Expanded body: tool-specific renderer + optional skill instructions.
 *
 * Special inline cases:
 * - teammate_spawned renders as a small badge instead of full card.
 * - SendMessage with shutdown intent renders as an inline indicator.
 */
export function LinkedToolItemDisplay({ tool }: Props) {
  const expanded = useSessionViewStore((s) => s.expandedTools.has(tool.id));
  const toggleTool = useSessionViewStore((s) => s.toggleTool);

  const { name, input, result, durationMs, isOrphaned, callTokens, skillInstructions, skillInstructionsTokenCount } = tool;

  // ─── Special inline cases ───────────────────────────────────────────────────

  // teammate_spawned: render as a compact inline badge
  if (name === 'teammate_spawned') {
    const teammateName = (input.name as string) ?? 'teammate';
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-medium my-1">
        <Zap className="w-3 h-3" />
        Spawned {teammateName}
      </span>
    );
  }

  // SendMessage shutdown: render as a compact inline indicator
  if (name === 'SendMessage') {
    const isShutdown =
      (input.action as string) === 'shutdown' ||
      (input.type as string) === 'shutdown';
    if (isShutdown) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium my-1">
          SendMessage shutdown
        </span>
      );
    }
  }

  // ─── Standard collapsible card ──────────────────────────────────────────────

  const isError = result?.isError ?? false;
  const Icon = toolIcons[name] || Wrench;
  const summary = generateToolSummary(name, input);
  const ToolRenderer = getToolRenderer(name);
  const execution = toToolExecution(tool);

  // Total tokens for this tool call (call tokens + result tokens)
  const totalTokens = (callTokens ?? 0) + (result?.tokenCount ?? 0);

  const borderClass = isError
    ? 'border-red-300 bg-red-50/30'
    : isOrphaned
      ? 'border-amber-300 bg-amber-50/30'
      : 'border-slate-200 bg-white';

  return (
    <div className={`border rounded-lg overflow-hidden my-2 ${borderClass}`}>
      {/* Collapsed header row */}
      <button
        onClick={() => toggleTool(tool.id)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <Icon className={`w-4 h-4 flex-shrink-0 ${isError ? 'text-red-500' : 'text-slate-500'}`} />
        <span className="font-medium text-slate-700 text-xs">{name}</span>
        <span className="text-xs text-slate-500 truncate flex-1 text-left">{summary}</span>

        <span className="flex items-center gap-1.5 flex-shrink-0">
          {totalTokens > 0 && (
            <span className="text-xs text-slate-400">{formatTokensCompact(totalTokens)} tok</span>
          )}
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
          ) : (
            <Clock className="w-4 h-4 text-slate-300 animate-pulse" />
          )}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-slate-200">
          <div className="px-4 py-3">
            <ToolRenderer execution={execution} />
          </div>

          {/* Skill instructions (loaded by Skill tool) */}
          {skillInstructions && (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/50">
              <div className="flex items-center gap-1.5 mb-2">
                <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                <span className="text-xs font-medium text-indigo-700">
                  Skill Instructions
                  {skillInstructionsTokenCount != null && (
                    <span className="text-indigo-400 font-normal ml-1">
                      ({formatTokensCompact(skillInstructionsTokenCount)} tok)
                    </span>
                  )}
                </span>
              </div>
              <pre className="text-xs font-mono text-slate-600 whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto">
                {skillInstructions}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
