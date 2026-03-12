import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { GraphNodeData } from '../types.js';

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  done: 'bg-green-100 text-green-800',
  complete: 'bg-green-100 text-green-800',
  blocked: 'bg-red-100 text-red-800',
  not_started: 'bg-gray-100 text-gray-600',
};

function statusBadgeClass(status: string): string {
  const key = status?.toLowerCase() ?? '';
  if (key.startsWith('blocked')) return STATUS_COLORS.blocked;
  return STATUS_COLORS[key] ?? STATUS_COLORS.not_started;
}

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
  const dimmed = nodeData.highlightState === 'none';

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-purple-400" />
      <div
        className={`
          flex items-center gap-2 rounded-md border-l-4 border-purple-500
          bg-purple-50 px-3 py-2 shadow-sm
          ${highlightClasses(nodeData.highlightState)}
        `}
        style={{
          width: 200,
          height: 56,
          opacity: dimmed ? 0.3 : 1,
        }}
      >
        <span className="flex-1 truncate text-sm font-medium text-purple-900">
          {nodeData.title}
        </span>
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${statusBadgeClass(nodeData.status)}`}
        >
          {nodeData.status}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-purple-400" />
    </>
  );
}

export default memo(EpicNode);
