import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { highlightLine } from '../../../utils/syntax-highlighter.js';

const markdownComponents: Components = {
  code({ className, children, ...props }) {
    const isInline = !className;
    if (isInline) {
      return (
        <code
          className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono"
          {...props}
        >
          {children}
        </code>
      );
    }
    const lang = className?.replace('language-', '') || '';
    const raw = String(children).replace(/\n$/, '');
    const lines = raw.split('\n');
    return (
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto text-xs">
        <code className={className} data-language={lang} {...props}>
          {lines.map((line, i) => (
            <span key={i}>
              {lang ? highlightLine(line, lang) : line}
              {i < lines.length - 1 ? '\n' : null}
            </span>
          ))}
        </code>
      </pre>
    );
  },
  pre({ children }) {
    return <>{children}</>;
  },
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
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-full">{children}</table>
      </div>
    );
  },
};

interface Props {
  content: string;
}

export function TextItem({ content }: Props) {
  return (
    <div className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
