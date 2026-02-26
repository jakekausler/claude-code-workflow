import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function DefaultRenderer({ execution }: Props) {
  const { input, result } = execution;

  const resultContent = extractResultContent(result);

  return (
    <div className="space-y-3 text-sm">
      {/* Input params */}
      <div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
          Input
        </div>
        <div className="bg-slate-50 rounded-lg p-3 space-y-1">
          {Object.entries(input).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-slate-500 font-mono text-xs flex-shrink-0">{key}:</span>
              <span className="text-slate-800 text-xs font-mono break-all">
                {typeof value === 'string'
                  ? value.length > 200
                    ? value.slice(0, 200) + '\u2026'
                    : value
                  : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Output */}
      {resultContent && (
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
            {result?.isError ? 'Error' : 'Output'}
          </div>
          <pre
            className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto ${
              result?.isError
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-slate-50 text-slate-800'
            }`}
          >
            {resultContent}
          </pre>
        </div>
      )}
    </div>
  );
}
