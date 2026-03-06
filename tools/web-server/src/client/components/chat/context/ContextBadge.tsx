import { useState, useRef, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatTokensCompact } from '../../../utils/session-formatters.js';
import type {
  ContextStats,
  ContextItemDetail,
  ToolTokenBreakdown,
  ThinkingTextBreakdown,
} from '../../../types/session.js';

interface Props {
  stats: ContextStats;
}

/** Format token count with ~ prefix */
function fmtTokens(n: number): string {
  return `~${formatTokensCompact(n)} tokens`;
}

interface CategoryDef {
  key: string;
  label: string;
  count: number;
  tokens: number;
  items?: ContextItemDetail[];
  toolItems?: ToolTokenBreakdown[];
  thinkingTextDetail?: ThinkingTextBreakdown;
}

function buildCategories(stats: ContextStats): CategoryDef[] {
  const t = stats.turnTokens;
  const defs: CategoryDef[] = [
    {
      key: 'userMessages',
      label: 'User Messages',
      count: stats.userMessageItems?.length ?? 0,
      tokens: t.userMessages,
      items: stats.userMessageItems,
    },
    {
      key: 'claudeMd',
      label: 'CLAUDE.md Files',
      count: stats.claudeMdItems?.length ?? 0,
      tokens: t.claudeMd,
      items: stats.claudeMdItems,
    },
    {
      key: 'mentionedFiles',
      label: 'Mentioned Files',
      count: stats.mentionedFileItems?.length ?? 0,
      tokens: t.mentionedFiles,
      items: stats.mentionedFileItems,
    },
    {
      key: 'toolOutputs',
      label: 'Tool Outputs',
      count: stats.toolOutputItems?.length ?? 0,
      tokens: t.toolOutputs,
      toolItems: stats.toolOutputItems,
    },
    {
      key: 'taskCoordination',
      label: 'Task Coordination',
      count: stats.taskCoordinationItems?.length ?? 0,
      tokens: t.taskCoordination,
      items: stats.taskCoordinationItems,
    },
    {
      key: 'thinkingText',
      label: 'Thinking + Text',
      count: t.thinkingText > 0 ? 1 : 0,
      tokens: t.thinkingText,
      thinkingTextDetail: stats.thinkingTextDetail,
    },
  ];
  return defs.filter((d) => d.tokens > 0);
}

export function ContextBadge({ stats }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimeout = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearHideTimeout();
    setShowPopover(true);
  };

  const handleMouseLeave = () => {
    clearHideTimeout();
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const totalNewCount =
    (stats.userMessageItems?.length ?? 0) +
    (stats.claudeMdItems?.length ?? 0) +
    (stats.mentionedFileItems?.length ?? 0) +
    (stats.toolOutputItems?.length ?? 0) +
    (stats.taskCoordinationItems?.length ?? 0) +
    (stats.thinkingTextDetail ? 1 : 0);

  const totalNewTokens = stats.totalTokens;
  if (totalNewCount === 0) return null;

  const categories = buildCategories(stats);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const hasExpandableItems = (cat: CategoryDef): boolean => {
    if (cat.items && cat.items.length > 0) return true;
    if (cat.toolItems && cat.toolItems.length > 0) return true;
    if (cat.thinkingTextDetail) return true;
    return false;
  };

  return (
    <div className="relative inline-block">
      <button
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={() => setShowPopover(true)}
        onBlur={() => setShowPopover(false)}
        className="text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5 font-medium hover:bg-slate-200 transition-colors"
      >
        Context <span className="font-semibold">+{totalNewCount}</span>
      </button>
      {showPopover && categories.length > 0 && (
        <div
          className="absolute z-50 bottom-full right-0 mb-1 w-72 bg-slate-900 rounded-lg shadow-lg border border-slate-700 p-3 max-h-80 overflow-y-auto"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="text-xs font-medium text-slate-300 mb-2">
            New Context Injected In This Turn
          </div>
          <div className="space-y-0.5 text-xs">
            {categories.map((cat) => {
              const expanded = expandedKeys.has(cat.key);
              const expandable = hasExpandableItems(cat);
              return (
                <div key={cat.key}>
                  <button
                    type="button"
                    disabled={!expandable}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (expandable) toggleExpand(cat.key);
                    }}
                    className={`flex items-center justify-between w-full py-0.5 ${
                      expandable ? 'cursor-pointer hover:text-slate-200' : 'cursor-default'
                    } text-slate-300`}
                  >
                    <span className="flex items-center gap-1 font-medium">
                      {expandable && (
                        <ChevronRight
                          className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                        />
                      )}
                      {!expandable && <span className="w-3" />}
                      {cat.label} ({cat.count})
                    </span>
                    <span className="font-mono text-slate-400">{fmtTokens(cat.tokens)}</span>
                  </button>
                  {expanded && expandable && (
                    <div className="pl-4 space-y-0.5 text-slate-400">
                      {cat.items?.map((item, i) => (
                        <div key={i} className="flex justify-between py-px">
                          <span className="truncate mr-2">{item.label}</span>
                          <span className="font-mono flex-shrink-0">{fmtTokens(item.tokens)}</span>
                        </div>
                      ))}
                      {cat.toolItems?.map((item, i) => (
                        <div key={i} className="flex justify-between py-px">
                          <span className="truncate mr-2">{item.toolName}</span>
                          <span className="font-mono flex-shrink-0">
                            {fmtTokens(item.tokenCount)}
                          </span>
                        </div>
                      ))}
                      {cat.thinkingTextDetail && (
                        <>
                          <div className="flex justify-between py-px">
                            <span>Thinking</span>
                            <span className="font-mono">
                              {fmtTokens(cat.thinkingTextDetail.thinking)}
                            </span>
                          </div>
                          <div className="flex justify-between py-px">
                            <span>Text</span>
                            <span className="font-mono">
                              {fmtTokens(cat.thinkingTextDetail.text)}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-slate-700 pt-1.5 mt-1.5">
            <div className="flex justify-between text-xs font-medium text-slate-200">
              <span>Total new tokens</span>
              <span className="font-mono">{fmtTokens(totalNewTokens)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
