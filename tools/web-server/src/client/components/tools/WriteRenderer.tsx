import { FilePlus } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function WriteRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const content = input.content as string | undefined;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <FilePlus className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
        </div>
      )}
      {content && (
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {content}
        </pre>
      )}
    </div>
  );
}
