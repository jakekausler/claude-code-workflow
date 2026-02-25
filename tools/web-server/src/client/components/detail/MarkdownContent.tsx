import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// TODO: Add Shiki syntax highlighting for code blocks when content is served

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
