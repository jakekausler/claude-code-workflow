import { FileText } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function ReadRenderer({ execution }: Props) {
  const { input, result } = execution;
  const filePath = input.file_path as string | undefined;
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  const content = extractResultContent(result);

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <FileText className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
          {offset != null && limit != null && (
            <span className="text-xs text-slate-400">lines {offset}-{offset + limit}</span>
          )}
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
