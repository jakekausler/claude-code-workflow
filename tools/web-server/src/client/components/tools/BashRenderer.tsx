import { TerminalSquare } from 'lucide-react';
import { extractResultContent, formatDuration } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

// Strip ANSI escape sequences (colors, cursor movements, etc.)
// eslint-disable-next-line no-control-regex
export function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '');
}

export function isStderrLine(line: string): boolean {
  return (
    line.startsWith('Error:') ||
    line.startsWith('error:') ||
    line.startsWith('ERR!') ||
    line.startsWith('ERR ') ||
    line.startsWith('WARN') ||
    line.startsWith('Warning:') ||
    line.startsWith('warning:') ||
    line.startsWith('fatal:') ||
    line.startsWith('Fatal:') ||
    /^\s*at /.test(line)
  );
}

export function BashRenderer({ execution }: Props) {
  const { input, result, durationMs } = execution;
  const command = input.command as string | undefined;
  const description = input.description as string | undefined;

  const rawOutput = extractResultContent(result);
  const output = rawOutput ? stripAnsi(rawOutput) : null;

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
            <div key={i} className={isStderrLine(line) ? 'text-amber-400' : 'text-green-400'}>
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
