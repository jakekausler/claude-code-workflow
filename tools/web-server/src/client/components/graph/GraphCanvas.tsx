import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from '@xyflow/react';

import EpicNode from './nodes/EpicNode.js';
import TicketNode from './nodes/TicketNode.js';
import StageNode from './nodes/StageNode.js';
import DependencyEdge from './edges/DependencyEdge.js';
import { GraphControls } from './GraphControls.js';

const nodeTypes = {
  epicNode: EpicNode,
  ticketNode: TicketNode,
  stageNode: StageNode,
};

const edgeTypes = {
  dependencyEdge: DependencyEdge,
};

const defaultEdgeOptions = { type: 'dependencyEdge' };

interface GraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (nodeId: string, nodeType: string) => void;
  onPaneClick: () => void;
  isLayouting: boolean;
}

function GraphCanvasInner({
  nodes,
  edges,
  onNodeClick,
  onPaneClick,
  isLayouting,
}: GraphCanvasProps) {
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeType = (node.data as Record<string, unknown>).type as string;
      onNodeClick(node.id, nodeType);
    },
    [onNodeClick],
  );

  // SVG defs for the arrowhead marker used by DependencyEdge
  const svgDefs = useMemo(
    () => (
      <svg>
        <defs>
          <marker
            id="arrowhead"
            markerWidth="6"
            markerHeight="4"
            refX="6"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="#94a3b8" />
          </marker>
        </defs>
      </svg>
    ),
    [],
  );

  return (
    <div className="relative h-full w-full">
      {svgDefs}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={handleNodeClick}
        onPaneClick={onPaneClick}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={4}
      >
        <GraphControls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          className="!bottom-2 !right-2"
        />
      </ReactFlow>
      {isLayouting && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        </div>
      )}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
