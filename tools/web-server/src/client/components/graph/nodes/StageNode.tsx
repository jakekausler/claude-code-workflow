import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../types.js';
import { statusBorderColor } from './statusColor.js';

function highlightClasses(state: GraphNodeData['highlightState']): string {
  switch (state) {
    case 'selected':
      return 'ring-2 ring-green-400';
    case 'direct':
      return 'ring-1 ring-green-300';
    case 'transitive':
      return 'ring-1 ring-green-200 ring-dashed';
    case 'none':
      return '';
  }
}

function StageNode({ data }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  const dimmed = nodeData.hasSelection && nodeData.highlightState === 'none';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-green-400" />
      <div
        className={`
          rounded-md border-l-4
          bg-green-50 px-2.5 py-1 shadow-sm
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          borderLeftColor: statusBorderColor(nodeData.status),
          width: 160,
          minHeight: 40,
          opacity: dimmed ? 0.3 : 1,
        }}
      >
        <span className="block text-xs font-medium text-green-900">
          {nodeData.title}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-green-400" />
    </>
  );
}

export default memo(StageNode);
