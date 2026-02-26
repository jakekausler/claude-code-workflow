import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { LastOutput } from '../../utils/last-output-detector.js';

interface Props {
  lastOutput: LastOutput | null;
}

export function LastOutputDisplay({ lastOutput }: Props) {
  if (!lastOutput) return null;

  switch (lastOutput.type) {
    case 'text':
      return (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mt-2 max-h-48 overflow-y-auto">
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {lastOutput.content ?? ''}
            </ReactMarkdown>
          </div>
        </div>
      );

    case 'tool_result': {
      const isError = lastOutput.isError ?? false;
      if (isError) {
        return (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 mt-2 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-700 font-medium">
              {lastOutput.toolName ?? 'Tool'}
            </span>
            {lastOutput.content && (
              <code className="text-xs text-red-600 font-mono truncate">
                {lastOutput.content}
              </code>
            )}
          </div>
        );
      }
      return (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 mt-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          <span className="text-sm text-green-700 font-medium">
            {lastOutput.toolName ?? 'Tool'}
          </span>
          {lastOutput.content && (
            <code className="text-xs text-green-600 font-mono truncate">
              {lastOutput.content}
            </code>
          )}
        </div>
      );
    }

    case 'interruption':
      return (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 mt-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-sm text-amber-700">Interrupted</span>
        </div>
      );

    case 'ongoing':
      return (
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-sm text-blue-600">Claude is responding...</span>
        </div>
      );

    default:
      return null;
  }
}
