import { ThinkingItem } from './items/ThinkingItem.js';
import { TextItem } from './items/TextItem.js';
import { LinkedToolItemDisplay } from './items/LinkedToolItemDisplay.js';
import { SubagentItem } from './items/SubagentItem.js';
import type { AIGroupDisplayItem } from '../../types/groups.js';

interface Props {
  items: AIGroupDisplayItem[];
}

function displayItemKey(item: AIGroupDisplayItem): string {
  switch (item.type) {
    case 'tool': return `tool-${item.tool.id}`;
    case 'subagent': return `sub-${item.subagent.id}`;
    case 'thinking': return `thinking-${item.timestamp instanceof Date ? item.timestamp.getTime() : item.timestamp}`;
    case 'output': return `output-${item.timestamp instanceof Date ? item.timestamp.getTime() : item.timestamp}`;
    case 'subagent_input': return `input-${item.timestamp instanceof Date ? item.timestamp.getTime() : item.timestamp}`;
    case 'compact_boundary': return `compact-${item.phaseNumber}`;
    case 'slash': return `slash-${item.slash.id}`;
    case 'teammate_message': return `tm-${item.teammateMessage.teammateId}-${item.teammateMessage.timestamp instanceof Date ? item.teammateMessage.timestamp.getTime() : item.teammateMessage.timestamp}`;
  }
}

export function DisplayItemList({ items }: Props) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <DisplayItemRenderer key={displayItemKey(item)} item={item} />
      ))}
    </div>
  );
}

function DisplayItemRenderer({ item }: { item: AIGroupDisplayItem }) {
  switch (item.type) {
    case 'thinking':
      return <ThinkingItem content={item.content} tokenCount={item.tokenCount} />;
    case 'tool':
      return <LinkedToolItemDisplay tool={item.tool} />;
    case 'subagent':
      return <SubagentItem process={item.subagent} />;
    case 'output':
      return <TextItem content={item.content} />;
    case 'slash':
      return (
        <div className="flex items-center gap-2 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded px-2 py-1 my-1">
          <span className="font-medium">/{item.slash.name}</span>
          {item.slash.args && <span className="text-purple-400">{item.slash.args}</span>}
        </div>
      );
    case 'teammate_message':
      return (
        <div className="text-xs border border-teal-200 bg-teal-50 rounded px-3 py-2 my-1">
          <span className="font-medium text-teal-700">Teammate {item.teammateMessage.teammateId}</span>
          {item.teammateMessage.summary && <span className="text-teal-500 ml-2">{item.teammateMessage.summary}</span>}
          <div className="mt-1 text-teal-800">{item.teammateMessage.content}</div>
        </div>
      );
    case 'subagent_input':
      return (
        <div className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-2 py-1.5 my-1">
          <span className="font-medium">Input:</span> {item.content}
        </div>
      );
    case 'compact_boundary':
      return (
        <div className="flex items-center gap-2 text-xs text-amber-600 my-2">
          <div className="flex-1 h-px bg-amber-200" />
          <span>Phase {item.phaseNumber}</span>
          <div className="flex-1 h-px bg-amber-200" />
        </div>
      );
    default:
      return null;
  }
}
