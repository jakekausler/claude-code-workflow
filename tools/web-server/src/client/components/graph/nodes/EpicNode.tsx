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
const BASE_BG = '#faf5ff'; // purple-50

function EpicNode({ data }: NodeProps) {
  const nodeData = data as unknown as GraphNodeData;
  const dimmed = nodeData.hasSelection && nodeData.highlightState === 'none';
  const ss = getStatusStyle(nodeData.status, BASE_BG);

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-purple-400" />
      <div
        className={`
          flex rounded-md
          shadow-sm
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          width: 200,
          minHeight: 56,
          opacity: dimmed ? 0.3 : ss.opacity,
          background: ss.background,
        }}
      >
        <div
          className="w-1 shrink-0 rounded-l-md"
          style={{ backgroundColor: BORDER_COLOR }}
        />
        <div title={`${nodeData.id} — ${nodeData.status}`} className="px-3 py-2">
          <span className={`block text-sm font-medium ${ss.textClass || 'text-purple-900'}`}>
            {nodeData.title}
          </span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" />
    </>
  );
}

export default memo(EpicNode);
