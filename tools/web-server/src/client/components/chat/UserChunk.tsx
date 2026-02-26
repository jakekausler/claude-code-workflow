import { User } from 'lucide-react';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { UserChunk as UserChunkType, TextContent } from '../../types/session.js';

interface Props {
  chunk: UserChunkType;
}

export function UserChunk({ chunk }: Props) {
  const { message, timestamp } = chunk;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === 'text')
          .map((b) => b.text)
          .join('\n');

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
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
