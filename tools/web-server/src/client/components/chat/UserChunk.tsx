import { useState } from 'react';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { UserChunk as UserChunkType, TextContent, ImageContent, ContentBlock } from '../../types/session.js';

const COLLAPSE_THRESHOLD = 500;

const markdownComponents: Components = {
  ol({ children }) {
    return (
      <ol className="my-1 list-decimal space-y-0.5 pl-5">
        {children}
      </ol>
    );
  },
  ul({ children }) {
    return (
      <ul className="my-1 list-disc space-y-0.5 pl-5">
        {children}
      </ul>
    );
  },
  li({ children }) {
    return <li className="text-sm">{children}</li>;
  },
};

interface Props {
  chunk: UserChunkType;
}

export function UserChunk({ chunk }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { message, timestamp } = chunk;

  const contentBlocks: ContentBlock[] | null =
    typeof message.content === 'string' ? null : message.content;

  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === 'text')
          .map((b) => b.text)
          .join('\n');

  const imageCount = contentBlocks
    ? contentBlocks.filter((b): b is ImageContent => b.type === 'image').length
    : 0;

  const isLong = text.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '\u2026' : text;

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          {imageCount > 0 && (
            <span className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mb-1">
              [{imageCount} image{imageCount > 1 ? 's' : ''}]
            </span>
          )}
          <div className="prose prose-sm prose-invert max-w-none text-sm [&_p]:my-1 [&_pre]:bg-blue-700 [&_code]:bg-blue-700 [&_code]:text-blue-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {displayText}
            </ReactMarkdown>
          </div>
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-200 hover:text-white underline mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          <div className="text-xs text-blue-200 mt-1 text-right">
            {formatTimestamp(timestamp)}
          </div>
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <User className="w-4 h-4 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
