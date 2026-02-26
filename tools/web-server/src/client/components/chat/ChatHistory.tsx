import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AIChatGroup } from './AIChatGroup.js';
import { UserChatGroup } from './UserChatGroup.js';
import { SystemChatGroup } from './SystemChatGroup.js';
import { CompactBoundary } from './CompactBoundary.js';
import { useSessionViewStore } from '../../store/session-store.js';
import type { ChatItem } from '../../types/groups.js';
import type { ContextStats } from '../../types/session.js';

interface Props {
  items: ChatItem[];
  contextStats?: Map<string, ContextStats>;
  totalPhases?: number;
}

const VIRTUALIZATION_THRESHOLD = 120;
const ESTIMATE_SIZE = 260;
const OVERSCAN = 8;
const NEAR_BOTTOM_PX = 100;

export function ChatHistory({ items, contextStats, totalPhases }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isNearBottom, setIsNearBottom } = useSessionViewStore();

  const dataLength = items.length;
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
    return (
      <VirtualizedItemList
        parentRef={parentRef}
        items={items}
        contextStats={contextStats}
        totalPhases={totalPhases}
        onScroll={handleScroll}
      />
    );
  }

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      onScroll={handleScroll}
    >
      {items.map((item, i) => (
        <ItemRenderer key={itemKey(item, i)} item={item} contextStats={contextStats} totalPhases={totalPhases} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item-based rendering
// ---------------------------------------------------------------------------

function itemKey(item: ChatItem, index: number): string {
  return `${item.type}-${item.group.id}-${index}`;
}

function ItemRenderer({ item, contextStats, totalPhases }: {
  item: ChatItem;
  contextStats?: Map<string, ContextStats>;
  totalPhases?: number;
}) {
  switch (item.type) {
    case 'user':
      return <UserChatGroup userGroup={item.group} />;
    case 'ai':
      return (
        <AIChatGroup
          aiGroup={item.group}
          contextStats={contextStats?.get(item.group.id)}
          totalPhases={totalPhases}
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
  totalPhases,
  onScroll,
}: {
  parentRef: React.RefObject<HTMLDivElement | null>;
  items: ChatItem[];
  contextStats?: Map<string, ContextStats>;
  totalPhases?: number;
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
                totalPhases={totalPhases}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
