import { formatTokenCount } from '../../utils/session-formatters.js';

interface Props {
  mainTokens: number;
  subagentTokens?: number;
}

export function MetricsPill({ mainTokens, subagentTokens }: Props) {
  return (
    <span
      className="inline-flex items-center bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs font-mono"
      title={`Main: ${mainTokens.toLocaleString()} tokens${subagentTokens ? ` | Subagent: ${subagentTokens.toLocaleString()} tokens` : ''}`}
    >
      {formatTokenCount(mainTokens)}
      {subagentTokens != null && subagentTokens > 0 && (
        <>
          <span className="text-slate-400 mx-1">|</span>
          {formatTokenCount(subagentTokens)}
        </>
      )}
    </span>
  );
}
