import { Terminal } from 'lucide-react';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { SystemChunk as SystemChunkType, TextContent } from '../../types/session.js';

interface Props {
  chunk: SystemChunkType;
}

export function SystemChunk({ chunk }: Props) {
  const { messages, timestamp } = chunk;
  const texts = messages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      return m.content
        .filter((b): b is TextContent => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    })
    .filter(Boolean);

  if (texts.length === 0) return null;

  return (
    <div className="flex justify-center mb-4">
      <div className="max-w-[70%] bg-slate-100 border border-slate-200 rounded-lg px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Terminal className="w-3 h-3" />
          <span>System</span>
          <span className="ml-auto">{formatTimestamp(timestamp)}</span>
        </div>
        {texts.map((text, i) => (
          <pre key={i} className="text-xs text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">
            {text}
          </pre>
        ))}
      </div>
    </div>
  );
}
