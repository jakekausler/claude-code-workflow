import { useState } from 'react';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatTimestampLong } from '../../utils/session-formatters.js';
import type { UserGroup } from '../../types/groups.js';

const COLLAPSE_THRESHOLD = 500;

interface Props {
  userGroup: UserGroup;
}

export function UserChatGroup({ userGroup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { content, timestamp } = userGroup;
  const text = content.text ?? '';
  const imageCount = content.images.length;
  const isLong = text.length > COLLAPSE_THRESHOLD;
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '\u2026' : text;

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          {content.commands.length > 0 && (
            <div className="mb-1">
              {content.commands.map((cmd, i) => (
                <span key={i} className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mr-1">
                  /{cmd.name}{cmd.args ? ` ${cmd.args}` : ''}
                </span>
              ))}
            </div>
          )}
          {imageCount > 0 && (
            <span className="inline-block text-xs bg-blue-500 text-blue-100 rounded px-1.5 py-0.5 mb-1">
              [{imageCount} image{imageCount > 1 ? 's' : ''}]
            </span>
          )}
          <div className="prose prose-sm prose-invert max-w-none text-sm [&_p]:my-1 [&_pre]:bg-blue-700 [&_code]:bg-blue-700 [&_code]:text-blue-100">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
          </div>
          {content.fileReferences.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {content.fileReferences.map((ref, i) => (
                <span key={i} className="text-xs bg-blue-500/50 text-blue-100 rounded px-1.5 py-0.5 font-mono">
                  @{ref.path}
                </span>
              ))}
            </div>
          )}
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-blue-200 hover:text-white underline mt-1"
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
          <div className="text-xs text-blue-200 mt-1 text-right">
            {formatTimestampLong(timestamp)}
          </div>
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <User className="w-4 h-4 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
