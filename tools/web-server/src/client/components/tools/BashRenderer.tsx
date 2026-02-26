import { TerminalSquare } from 'lucide-react';
import { formatDuration } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function BashRenderer({ execution }: Props) {
  const { input, result, durationMs } = execution;
  const command = input.command as string | undefined;
  const description = input.description as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  const isStderrLine = (line: string) =>
    line.startsWith('Error:') ||
    line.startsWith('error:') ||
    line.startsWith('ERR!') ||
    line.startsWith('WARN') ||
    line.startsWith('fatal:');

  return (
    <div className="space-y-2 text-sm">
      {description && (
        <div className="text-xs text-slate-500 italic">{description}</div>
      )}
      {command && (
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <code className="text-xs font-mono text-slate-800 bg-slate-100 px-2 py-1 rounded break-all">
            {command}
          </code>
        </div>
      )}
      {output && (
        <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
          {output.split('\n').map((line, i) => (
            <div key={i} className={isStderrLine(line) ? 'text-red-400' : 'text-green-400'}>
              {line}
            </div>
          ))}
        </pre>
      )}
      {durationMs != null && (
        <div className="text-xs text-slate-400">Duration: {formatDuration(durationMs)}</div>
      )}
      {result?.isError && (
        <div className="text-xs text-red-600 font-medium">Exit: non-zero</div>
      )}
    </div>
  );
}
