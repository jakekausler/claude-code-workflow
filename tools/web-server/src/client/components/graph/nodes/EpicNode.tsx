import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../types.js';
import { getStatusStyle } from './statusStyle.js';

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

const BORDER_COLOR = '#8b5cf6';
const HEADER_BG = '#faf5ff'; // purple-50

function EpicNode({ data }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  const dimmed = nodeData.hasSelection && nodeData.highlightState === 'none';
  const ss = getStatusStyle(nodeData.status, HEADER_BG);

  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-purple-400" />
      <div
        className={`
          rounded-md
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          width: '100%',
          height: '100%',
          opacity: dimmed ? 0.3 : 1,
          border: nodeData.isBlocked ? '2px solid #ef4444' : '1px solid #e2e8f0',
          borderLeft: `3px solid ${nodeData.isBlocked ? '#ef4444' : BORDER_COLOR}`,
          borderRadius: 6,
          background: 'transparent',
        }}
      >
        {/* Header bar */}
        <div
          style={{
            background: ss.background,
            opacity: ss.opacity,
            borderTopLeftRadius: 5,
            borderTopRightRadius: 5,
            padding: '4px 12px',
            borderBottom: '1px solid #e2e8f0',
          }}
        >
          <span
            className={`block text-sm font-medium ${ss.textClass || 'text-purple-900'}`}
            title={`${nodeData.id} — ${nodeData.status}`}
          >
            {nodeData.title}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-purple-400" />
    </>
  );
}

export default memo(EpicNode);
