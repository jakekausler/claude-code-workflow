import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

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
    return (
      <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto text-xs">
        <code className={className} data-language={lang} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  pre({ children }) {
    return <>{children}</>;
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
