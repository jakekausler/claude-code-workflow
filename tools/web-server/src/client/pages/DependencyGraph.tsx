import { useState, useMemo, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useGraph, useEpics } from '../api/hooks.js';
import type { GraphNode, GraphEdge } from '../api/hooks.js';
import { AlertTriangle, Loader2, AlertCircle, X } from 'lucide-react';
import { EpicDetailContent } from '../components/detail/EpicDetailContent.js';
import { TicketDetailContent } from '../components/detail/TicketDetailContent.js';
import { StageDetailContent } from '../components/detail/StageDetailContent.js';
import { GraphFilters } from '../components/graph/GraphFilters.js';
import { GraphCanvas } from '../components/graph/GraphCanvas.js';
import { useElkLayout } from '../components/graph/useElkLayout.js';
import { useGraphHighlight } from '../components/graph/useGraphHighlight.js';
import type { GraphNodeData, GraphEdgeData } from '../components/graph/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeType = 'epic' | 'ticket' | 'stage';

interface SelectedNode {
  id: string;
  type: NodeType;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesStatusFilter(status: string, filter: string): boolean {
  const s = status?.toLowerCase() ?? '';
  switch (filter) {
    case 'in_progress':
      return s === 'in_progress';
    case 'blocked':
      return s === 'blocked' || s.startsWith('blocked_by');
    case 'completed':
      return s === 'completed' || s === 'done' || s === 'complete';
    default:
      return true;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DependencyGraph() {
  const [epicFilter, setEpicFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [depTypeFilter, setDepTypeFilter] = useState<string>('');

  const epicFilters = epicFilter ? { epic: epicFilter } : undefined;

  const { data: graphData, isLoading, error } = useGraph(epicFilters);
  const { data: epics } = useEpics();

  // Selected node for inline detail panel
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);

  // ---------------------------------------------------------------------------
  // Client-side filtering
  // ---------------------------------------------------------------------------

  const allNodes: GraphNode[] = graphData?.nodes ?? [];
  const allEdges: GraphEdge[] = graphData?.edges ?? [];

  const filteredNodes = useMemo(() => {
    return allNodes.filter((n) => {
      if (statusFilter && !matchesStatusFilter(n.status, statusFilter)) return false;
      return true;
    });
  }, [allNodes, statusFilter]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const uniqueDepTypes = useMemo(() => {
    const types = new Set<string>();
    for (const e of allEdges) {
      if (e.type) types.add(e.type);
    }
    return Array.from(types).sort();
  }, [allEdges]);

  const filteredEdges = useMemo(() => {
    return allEdges.filter((e) => {
      if (!filteredNodeIds.has(e.from) || !filteredNodeIds.has(e.to)) return false;
      if (depTypeFilter && e.type !== depTypeFilter) return false;
      return true;
    });
  }, [allEdges, filteredNodeIds, depTypeFilter]);

  // ---------------------------------------------------------------------------
  // ELK Layout
  // ---------------------------------------------------------------------------

  const criticalPath = graphData?.critical_path ?? [];
  const { nodes: layoutNodes, edges: layoutEdges, isLayouting } = useElkLayout(
    filteredNodes,
    filteredEdges,
    criticalPath,
  );

  // ---------------------------------------------------------------------------
  // Highlight
  // ---------------------------------------------------------------------------

  const { getNodeHighlight, getEdgeHighlight } = useGraphHighlight(
    selectedNode?.id ?? null,
    layoutEdges,
  );

  // Apply highlight state to nodes and edges
  const highlightedNodes: Node[] = useMemo(() => {
    if (!selectedNode) return layoutNodes;
    return layoutNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        highlightState: getNodeHighlight(node.id),
      },
    }));
  }, [layoutNodes, selectedNode, getNodeHighlight]);

  const highlightedEdges: Edge[] = useMemo(() => {
    if (!selectedNode) return layoutEdges;
    return layoutEdges.map((edge) => ({
      ...edge,
      data: {
        ...edge.data,
        highlightState: getEdgeHighlight(edge.source, edge.target),
      },
    }));
  }, [layoutEdges, selectedNode, getEdgeHighlight]);

  // ---------------------------------------------------------------------------
  // Node click handler
  // ---------------------------------------------------------------------------

  const handleNodeClick = useCallback((nodeId: string, nodeType: string) => {
    setSelectedNode((prev) =>
      prev?.id === nodeId ? null : { id: nodeId, type: nodeType as NodeType },
    );
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cycles = graphData?.cycles ?? [];

  return (
    <div className="flex h-full flex-col space-y-4 overflow-hidden">
      <h1 className="shrink-0 text-2xl font-bold text-slate-900">Dependency Graph</h1>

      {/* Filters */}
      <GraphFilters
        epicFilter={epicFilter}
        setEpicFilter={setEpicFilter}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        depTypeFilter={depTypeFilter}
        setDepTypeFilter={setDepTypeFilter}
        epics={epics ?? []}
        depTypes={uniqueDepTypes}
      />

      {/* Cycle warnings */}
      {cycles.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Dependency cycles detected:</strong>
            <ul className="mt-1 list-inside list-disc">
              {cycles.map((cycle, i) => (
                <li key={i}>
                  {cycle.join(' → ')} → {cycle[0]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Main content area */}
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          Failed to load graph: {error.message}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Graph panel */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
            <GraphCanvas
              nodes={highlightedNodes}
              edges={highlightedEdges}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              isLayouting={isLayouting}
            />

            {/* Empty state */}
            {!isLayouting && highlightedNodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">
                No nodes to display
              </div>
            )}
          </div>

          {/* Inline detail panel */}
          {selectedNode && (
            <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
                <span className="text-sm font-semibold text-slate-700 capitalize">
                  {selectedNode.type}: {selectedNode.id}
                </span>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  title="Close panel"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {selectedNode.type === 'epic' && (
                  <EpicDetailContent epicId={selectedNode.id} />
                )}
                {selectedNode.type === 'ticket' && (
                  <TicketDetailContent ticketId={selectedNode.id} />
                )}
                {selectedNode.type === 'stage' && (
                  <StageDetailContent stageId={selectedNode.id} />
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
