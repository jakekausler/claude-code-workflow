import { CheckCircle2, FileCheck, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { AIGroupLastOutput } from '../../types/groups.js';

const markdownComponents: Components = {
  ol({ children }) {
    return (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-slate-700">
        {children}
      </ol>
    );
  },
  ul({ children }) {
    return (
      <ul className="my-2 list-disc space-y-1 pl-5 text-slate-700">
        {children}
      </ul>
    );
  },
  li({ children }) {
    return <li className="text-sm text-slate-700">{children}</li>;
  },
};

const planMarkdownComponents: Components = {
  ol({ children }) {
    return (
      <ol className="my-2 list-decimal space-y-1 pl-5 text-indigo-800">
        {children}
      </ol>
    );
  },
  ul({ children }) {
    return (
      <ul className="my-2 list-disc space-y-1 pl-5 text-indigo-800">
        {children}
      </ul>
    );
  },
  li({ children }) {
    return <li className="text-sm text-indigo-800">{children}</li>;
  },
};

interface Props {
  lastOutput: AIGroupLastOutput | null;
}

export function LastOutputDisplay({ lastOutput }: Props) {
  if (!lastOutput) return null;

  switch (lastOutput.type) {
    case 'text':
      return (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mt-2 max-h-48 overflow-y-auto">
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {lastOutput.text ?? ''}
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
            {lastOutput.toolResult && (
              <code className="text-xs text-red-600 font-mono truncate">
                {lastOutput.toolResult}
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
          {lastOutput.toolResult && (
            <code className="text-xs text-green-600 font-mono truncate">
              {lastOutput.toolResult}
            </code>
          )}
        </div>
      );
    }

    case 'ongoing':
      return (
        <div className="flex items-center gap-2 mt-2 px-1">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-sm text-blue-600">Claude is responding...</span>
        </div>
      );

    case 'plan_exit':
      return (
        <div className="mt-2">
          {lastOutput.planPreamble && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 mb-2">
              <div className="prose prose-sm prose-slate max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {lastOutput.planPreamble}
                </ReactMarkdown>
              </div>
            </div>
          )}
          <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-4 py-3 flex items-start gap-2">
            <FileCheck className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-medium text-indigo-700 mb-1">Plan Ready for Approval</div>
              <div className="prose prose-sm prose-indigo max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={planMarkdownComponents}>
                  {lastOutput.planContent ?? ''}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
