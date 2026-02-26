import { Search } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function GrepRenderer({ execution }: Props) {
  const { input, result } = execution;
  const pattern = input.pattern as string | undefined;
  const glob = input.glob as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  const lines = output ? output.split('\n').filter(Boolean) : [];

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Search className="w-4 h-4" />
        {pattern && (
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">"{pattern}"</code>
        )}
        {glob && <span className="text-xs text-slate-400">in {glob}</span>}
        <span className="text-xs text-slate-400">{lines.length} matches</span>
      </div>
      {lines.length > 0 && (
        <pre className="bg-slate-50 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {lines.map((line, i) => (
            <div key={i} className="text-slate-700 py-0.5">{line}</div>
          ))}
        </pre>
      )}
    </div>
  );
}
