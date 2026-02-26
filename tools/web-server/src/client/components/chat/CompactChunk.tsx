import { Minimize2 } from 'lucide-react';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { CompactChunk as CompactChunkType } from '../../types/session.js';

interface Props {
  chunk: CompactChunkType;
}

export function CompactChunk({ chunk }: Props) {
  return (
    <div className="flex items-center gap-3 my-6 px-4">
      <div className="flex-1 h-px bg-amber-300" />
      <div
        className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1"
        title={chunk.summary || undefined}
      >
        <Minimize2 className="w-3 h-3" />
        <span className="font-medium">Context compacted</span>
        <span className="text-amber-500">{formatTimestamp(chunk.timestamp)}</span>
      </div>
      <div className="flex-1 h-px bg-amber-300" />
    </div>
  );
}
