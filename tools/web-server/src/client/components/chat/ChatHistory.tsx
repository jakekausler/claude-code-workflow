import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { UserChunk } from './UserChunk.js';
import { AIChunk } from './AIChunk.js';
import { SystemChunk } from './SystemChunk.js';
import { CompactChunk } from './CompactChunk.js';
import { AIChatGroup } from './AIChatGroup.js';
import { UserChatGroup } from './UserChatGroup.js';
import { SystemChatGroup } from './SystemChatGroup.js';
import { CompactBoundary } from './CompactBoundary.js';
import { useSessionViewStore } from '../../store/session-store.js';
import type { Chunk } from '../../types/session.js';
import type { ChatItem } from '../../types/groups.js';
import type { ContextStats, ContextPhaseInfo, Process } from '../../types/session.js';

interface Props {
  chunks?: Chunk[];
  items?: ChatItem[];
  subagents?: Process[];
  contextStats?: Map<string, ContextStats>;
  phases?: ContextPhaseInfo[];
}

const VIRTUALIZATION_THRESHOLD = 120;
const ESTIMATE_SIZE = 260;
const OVERSCAN = 8;
const NEAR_BOTTOM_PX = 100;

export function ChatHistory({ chunks, items, subagents, contextStats, phases }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isNearBottom, setIsNearBottom } = useSessionViewStore();

  // Use items (new path) if provided, otherwise fall back to chunks (legacy)
  const useNewPath = !!items;
  const dataLength = useNewPath ? items!.length : (chunks?.length ?? 0);
  const shouldVirtualize = dataLength > VIRTUALIZATION_THRESHOLD;

  // Auto-scroll to bottom when new data arrives and user is near bottom
  const scrollToBottom = useCallback(() => {
    if (!parentRef.current) return;
    parentRef.current.scrollTop = parentRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [dataLength, isNearBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsNearBottom(distFromBottom < NEAR_BOTTOM_PX);
  }, [setIsNearBottom]);

  if (shouldVirtualize) {
    if (useNewPath) {
      return (
        <VirtualizedItemList
          parentRef={parentRef}
          items={items!}
          contextStats={contextStats}
          onScroll={handleScroll}
        />
      );
    }
    return (
      <VirtualizedList
        parentRef={parentRef}
        chunks={chunks!}
        onScroll={handleScroll}
      />
    );
  }

  // Non-virtualized rendering
  if (useNewPath) {
    return (
      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto px-4 py-6"
        onScroll={handleScroll}
      >
        {items!.map((item, i) => (
          <ItemRenderer key={itemKey(item, i)} item={item} contextStats={contextStats} />
        ))}
      </div>
    );
  }

  // Legacy: render raw chunks
  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      onScroll={handleScroll}
    >
      {(chunks ?? []).map((chunk, i) => (
        <ChunkRenderer key={`${chunk.type}-${i}`} chunk={chunk} chunkIndex={i} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New path: item-based rendering
// ---------------------------------------------------------------------------

function itemKey(item: ChatItem, index: number): string {
  return `${item.type}-${item.group.id}-${index}`;
}

function ItemRenderer({ item, contextStats }: {
  item: ChatItem;
  contextStats?: Map<string, ContextStats>;
}) {
  switch (item.type) {
    case 'user':
      return <UserChatGroup userGroup={item.group} />;
    case 'ai':
      return (
        <AIChatGroup
          aiGroup={item.group}
          contextStats={contextStats?.get(item.group.id)}
        />
      );
    case 'system':
      return <SystemChatGroup systemGroup={item.group} />;
    case 'compact':
      return <CompactBoundary compactGroup={item.group} />;
    default:
      return null;
  }
}

function VirtualizedItemList({
  parentRef,
  items,
  contextStats,
  onScroll,
}: {
  parentRef: React.RefObject<HTMLDivElement | null>;
  items: ChatItem[];
  contextStats?: Map<string, ContextStats>;
  onScroll: () => void;
}) {
  const virtualizer = useVirtualizer({
    count: items.length,
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
              <ItemRenderer
                item={items[virtualItem.index]}
                contextStats={contextStats}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legacy path: chunk-based rendering
// ---------------------------------------------------------------------------

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
              <ChunkRenderer chunk={chunks[virtualItem.index]} chunkIndex={virtualItem.index} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChunkRenderer({ chunk, chunkIndex }: { chunk: Chunk; chunkIndex: number }) {
  switch (chunk.type) {
    case 'user':
      return <UserChunk chunk={chunk} />;
    case 'ai':
      return <AIChunk chunk={chunk} chunkIndex={chunkIndex} />;
    case 'system':
      return <SystemChunk chunk={chunk} />;
    case 'compact':
      return <CompactChunk chunk={chunk} />;
    default:
      return null;
  }
}
