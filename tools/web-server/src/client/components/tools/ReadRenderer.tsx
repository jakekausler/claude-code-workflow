import { FileText } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import { inferLanguage, highlightLine } from '../../utils/syntax-highlighter.js';
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
  const language = filePath ? inferLanguage(filePath) : '';
  const lines = content ? content.replace(/\n$/, '').split('\n') : [];
  const startLine = offset ?? 1;

  // Width of the largest line number for right-alignment
  const maxLineNum = startLine + lines.length - 1;
  const gutterWidth = String(maxLineNum).length;

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
      {lines.length > 0 && (
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {lines.map((line, i) => {
            const lineNum = startLine + i;
            return (
              <div key={i} className="flex">
                <span
                  className="select-none text-slate-500 pr-3 mr-3 border-r border-slate-700 text-right"
                  style={{ minWidth: `${gutterWidth + 1}ch` }}
                >
                  {lineNum}
                </span>
                <span className="flex-1">
                  {language ? highlightLine(line, language) : line}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
