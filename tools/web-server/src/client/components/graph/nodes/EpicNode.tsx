import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../types.js';
import { statusBorderColor } from './statusColor.js';

function highlightClasses(state: GraphNodeData['highlightState']): string {
  switch (state) {
    case 'selected':
      return 'ring-2 ring-purple-400';
    case 'direct':
      return 'ring-1 ring-purple-300';
    case 'transitive':
      return 'ring-1 ring-purple-200 ring-dashed';
    case 'none':
      return '';
  }
}

function EpicNode({ data }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  const dimmed = nodeData.hasSelection && nodeData.highlightState === 'none';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-purple-400" />
      <div
        className={`
          rounded-md border-l-4
          bg-purple-50 px-3 py-2 shadow-sm
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          borderLeftColor: statusBorderColor(nodeData.status),
          width: 200,
          minHeight: 56,
          opacity: dimmed ? 0.3 : 1,
        }}
      >
        <span className="block text-sm font-medium text-purple-900">
          {nodeData.title}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" />
    </>
  );
}

export default memo(EpicNode);
