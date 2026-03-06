import { Notebook } from 'lucide-react';
import { CodeBlockViewer } from './CodeBlockViewer.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

type EditMode = 'replace' | 'insert' | 'delete';
type CellType = 'code' | 'markdown';

const editModeBadgeClass: Record<EditMode, string> = {
  replace: 'bg-blue-100 text-blue-700 border-blue-200',
  insert: 'bg-green-100 text-green-700 border-green-200',
  delete: 'bg-red-100 text-red-700 border-red-200',
};

function getBaseName(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
}

export function NotebookEditRenderer({ execution }: Props) {
  const { input } = execution;
  const notebookPath = (input.notebook_path as string) ?? '';
  const cellNumber = input.cell_number as number | undefined;
  const newSource = (input.new_source as string) ?? '';
  const editMode = (input.edit_mode as EditMode | undefined) ?? 'replace';
  const cellType = (input.cell_type as CellType | undefined) ?? 'code';

  const fileName = getBaseName(notebookPath);
  const badgeClass = editModeBadgeClass[editMode] ?? editModeBadgeClass.replace;
  const language = cellType === 'markdown' ? 'markdown' : 'python';

  return (
    <div className="space-y-2 text-sm">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Notebook className="w-4 h-4 shrink-0 text-slate-400" />
        <span
          className="font-mono text-xs text-slate-700 truncate"
          title={notebookPath}
        >
          {fileName}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium border ${badgeClass}`}
        >
          {editMode}
        </span>
        {cellNumber !== undefined && (
          <span className="text-xs text-slate-500">Cell #{cellNumber}</span>
        )}
        {input.cell_type !== undefined && (
          <span className="shrink-0 rounded px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 border border-slate-200">
            {cellType}
          </span>
        )}
      </div>

      {/* Source content */}
      {newSource && editMode !== 'delete' && (
        <CodeBlockViewer
          fileName={`cell.${language === 'markdown' ? 'md' : 'py'}`}
          content={newSource}
          language={language}
        />
      )}

      {editMode === 'delete' && (
        <div className="text-xs text-slate-400 italic pl-6">Cell deleted — no source content.</div>
      )}
    </div>
  );
}
