import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// TODO: Add Shiki syntax highlighting for code blocks when content is served

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

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
