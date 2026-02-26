import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { UserChunk } from './UserChunk.js';
import { AIChunk } from './AIChunk.js';
import { SystemChunk } from './SystemChunk.js';
import { CompactChunk } from './CompactChunk.js';
import { useSessionViewStore } from '../../store/session-store.js';
import type { Chunk } from '../../types/session.js';

interface Props {
  chunks: Chunk[];
}

const VIRTUALIZATION_THRESHOLD = 120;
const ESTIMATE_SIZE = 260;
const OVERSCAN = 8;
const NEAR_BOTTOM_PX = 100;

export function ChatHistory({ chunks }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isNearBottom, setIsNearBottom } = useSessionViewStore();
  const shouldVirtualize = chunks.length > VIRTUALIZATION_THRESHOLD;

  // Auto-scroll to bottom when new chunks arrive and user is near bottom
  const scrollToBottom = useCallback(() => {
    if (!parentRef.current) return;
    parentRef.current.scrollTop = parentRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [chunks.length, isNearBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsNearBottom(distFromBottom < NEAR_BOTTOM_PX);
  }, [setIsNearBottom]);

  if (shouldVirtualize) {
    return (
      <VirtualizedList
        parentRef={parentRef}
        chunks={chunks}
        onScroll={handleScroll}
      />
    );
  }

  // Non-virtualized: render all chunks directly
  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      onScroll={handleScroll}
    >
      {chunks.map((chunk, i) => (
        <ChunkRenderer key={`${chunk.type}-${i}`} chunk={chunk} />
      ))}
    </div>
  );
}

function VirtualizedList({
  parentRef,
  chunks,
  onScroll,
}: {
  parentRef: React.RefObject<HTMLDivElement | null>;
  chunks: Chunk[];
  onScroll: () => void;
}) {
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_SIZE,
    overscan: OVERSCAN,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4"
      onScroll={onScroll}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <div className="py-3">
              <ChunkRenderer chunk={chunks[virtualItem.index]} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChunkRenderer({ chunk }: { chunk: Chunk }) {
  switch (chunk.type) {
    case 'user':
      return <UserChunk chunk={chunk} />;
    case 'ai':
      return <AIChunk chunk={chunk} />;
    case 'system':
      return <SystemChunk chunk={chunk} />;
    case 'compact':
      return <CompactChunk chunk={chunk} />;
    default:
      return null;
  }
}
