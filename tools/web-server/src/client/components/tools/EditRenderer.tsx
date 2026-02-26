import { Pencil } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function EditRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <Pencil className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
        </div>
      )}
      <div className="rounded-lg overflow-hidden border border-slate-200">
        {oldString && (
          <div className="bg-red-50 border-b border-slate-200">
            <div className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 border-b border-red-200">
              Removed
            </div>
            <pre className="px-3 py-2 text-xs font-mono text-red-800 whitespace-pre-wrap overflow-x-auto">
              {oldString}
            </pre>
          </div>
        )}
        {newString && (
          <div className="bg-green-50">
            <div className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 border-b border-green-200">
              Added
            </div>
            <pre className="px-3 py-2 text-xs font-mono text-green-800 whitespace-pre-wrap overflow-x-auto">
              {newString}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
