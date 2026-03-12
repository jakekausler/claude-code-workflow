import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../types.js';
import { statusBorderColor } from './statusColor.js';

function highlightClasses(state: GraphNodeData['highlightState']): string {
  switch (state) {
    case 'selected':
      return 'ring-2 ring-blue-400';
    case 'direct':
      return 'ring-1 ring-blue-300';
    case 'transitive':
      return 'ring-1 ring-blue-200 ring-dashed';
    case 'none':
      return '';
  }
}

function TicketNode({ data }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  const dimmed = nodeData.hasSelection && nodeData.highlightState === 'none';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-blue-400" />
      <div
        className={`
          flex rounded-md
          bg-blue-50 shadow-sm
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          width: 180,
          minHeight: 48,
          opacity: dimmed ? 0.3 : 1,
        }}
      >
        <div
          title={nodeData.status}
          className="w-1 shrink-0 rounded-l-md"
          style={{ backgroundColor: statusBorderColor(nodeData.status) }}
        />
        <div title={nodeData.id} className="px-3 py-1.5">
          <span className="block text-sm font-medium text-blue-900">
            {nodeData.title}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400" />
    </>
  );
}

export default memo(TicketNode);
