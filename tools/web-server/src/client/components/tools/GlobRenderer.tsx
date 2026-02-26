import { FolderSearch } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function GlobRenderer({ execution }: Props) {
  const { input, result } = execution;
  const pattern = input.pattern as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  const files = output ? output.split('\n').filter(Boolean) : [];

  return (
    <div className="space-y-2 text-sm">
      {pattern && (
        <div className="flex items-center gap-2 text-slate-600">
          <FolderSearch className="w-4 h-4" />
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">{pattern}</code>
          <span className="text-xs text-slate-400">{files.length} files</span>
        </div>
      )}
      {files.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">
          {files.map((file, i) => (
            <div key={i} className="text-xs font-mono text-slate-700 py-0.5">{file}</div>
          ))}
        </div>
      )}
    </div>
  );
}
