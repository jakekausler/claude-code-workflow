import { FilePlus } from 'lucide-react';
import { inferLanguage, highlightLine } from '../../utils/syntax-highlighter.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function WriteRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const content = input.content as string | undefined;

  const language = filePath ? inferLanguage(filePath) : '';
  const lines = content ? content.replace(/\n$/, '').split('\n') : [];
  const gutterWidth = String(lines.length).length;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <FilePlus className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
        </div>
      )}
      {lines.length > 0 && (
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {lines.map((line, i) => {
            const lineNum = i + 1;
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
