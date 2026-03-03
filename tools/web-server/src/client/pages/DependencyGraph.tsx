import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useGraph, useEpics } from '../api/hooks.js';
import type { GraphNode, GraphEdge } from '../api/hooks.js';
import { AlertTriangle, Loader2, AlertCircle, ZoomIn, ZoomOut, Maximize2, X } from 'lucide-react';
import { EpicDetailContent } from '../components/detail/EpicDetailContent.js';
import { TicketDetailContent } from '../components/detail/TicketDetailContent.js';
import { StageDetailContent } from '../components/detail/StageDetailContent.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const NODE_W = 160;
const NODE_H = 48;
const H_GAP = 24;
const V_GAP = 100;
const ROW_PAD_TOP = 60;
const COL_PAD_LEFT = 40;

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

type NodeType = 'epic' | 'ticket' | 'stage';

interface NodeColors {
  fill: string;
  stroke: string;
}

function getNodeColors(node: GraphNode): NodeColors {
  const s = node.status?.toLowerCase() ?? '';

  // Status overrides
  if (s === 'blocked' || s.startsWith('blocked_by')) {
    return { fill: '#fee2e2', stroke: '#ef4444' };
  }
  if (s === 'in_progress') {
    return { fill: '#dbeafe', stroke: '#3b82f6' };
  }

  // Type defaults
  switch (node.type) {
    case 'epic':
      return { fill: '#e0e7ff', stroke: '#6366f1' };
    case 'ticket':
      return { fill: '#d1fae5', stroke: '#10b981' };
    case 'stage':
      return { fill: '#fef3c7', stroke: '#f59e0b' };
  }
}

function isCompleted(status: string): boolean {
  const s = status?.toLowerCase() ?? '';
  return s === 'completed' || s === 'done' || s === 'complete';
}

// ---------------------------------------------------------------------------
// Positioned node
// ---------------------------------------------------------------------------

interface PositionedNode extends GraphNode {
  x: number;
  y: number;
}

function layoutNodes(nodes: GraphNode[]): PositionedNode[] {
  const rows: Record<string, GraphNode[]> = { epic: [], ticket: [], stage: [] };
  for (const node of nodes) {
    if (rows[node.type]) {
      rows[node.type].push(node);
    }
  }

  const rowOrder: NodeType[] = ['epic', 'ticket', 'stage'];
  const result: PositionedNode[] = [];

  rowOrder.forEach((rowType, rowIndex) => {
    const rowNodes = rows[rowType];
    rowNodes.forEach((node, colIndex) => {
      result.push({
        ...node,
        x: COL_PAD_LEFT + colIndex * (NODE_W + H_GAP),
        y: ROW_PAD_TOP + rowIndex * (NODE_H + V_GAP),
      });
    });
  });

  return result;
}

function getSvgDimensions(nodes: PositionedNode[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 400, height: 200 };
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
  return { width: maxX + COL_PAD_LEFT, height: maxY + ROW_PAD_TOP };
}

// ---------------------------------------------------------------------------
// ViewBox state for zoom/pan
// ---------------------------------------------------------------------------

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------
// Tooltip state
// ---------------------------------------------------------------------------

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: string;
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

interface SelectedNode {
  id: string;
  type: NodeType;
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

  // Tooltip
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, content: '' });

  // Zoom/pan
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);
  const isPanning = useRef(false);
  const panStart = useRef<{ mx: number; my: number; vx: number; vy: number }>({ mx: 0, my: 0, vx: 0, vy: 0 });

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
  // Layout
  // ---------------------------------------------------------------------------

  const positionedNodes = useMemo(() => layoutNodes(filteredNodes), [filteredNodes]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of positionedNodes) m.set(n.id, n);
    return m;
  }, [positionedNodes]);

  const { width: svgW, height: svgH } = useMemo(() => getSvgDimensions(positionedNodes), [positionedNodes]);

  // Init/reset viewBox when graph dimensions change
  useEffect(() => {
    setViewBox({ x: 0, y: 0, w: svgW, h: svgH });
  }, [svgW, svgH]);

  // ---------------------------------------------------------------------------
  // Zoom/pan handlers
  // ---------------------------------------------------------------------------

  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      if (!viewBox || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // fraction of svg element
      const fx = mx / rect.width;
      const fy = my / rect.height;
      const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      const newW = Math.max(100, Math.min(svgW * 4, viewBox.w * factor));
      const newH = Math.max(60, Math.min(svgH * 4, viewBox.h * factor));
      setViewBox({
        x: viewBox.x + (viewBox.w - newW) * fx,
        y: viewBox.y + (viewBox.h - newH) * fy,
        w: newW,
        h: newH,
      });
    },
    [viewBox, svgW, svgH],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest('[data-node]')) return;
      isPanning.current = true;
      panStart.current = {
        mx: e.clientX,
        my: e.clientY,
        vx: viewBox?.x ?? 0,
        vy: viewBox?.y ?? 0,
      };
    },
    [viewBox],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isPanning.current || !viewBox || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const dx = ((e.clientX - panStart.current.mx) / rect.width) * viewBox.w;
      const dy = ((e.clientY - panStart.current.my) / rect.height) * viewBox.h;
      setViewBox({
        ...viewBox,
        x: panStart.current.vx - dx,
        y: panStart.current.vy - dy,
      });
    },
    [viewBox],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const zoomIn = useCallback(() => {
    setViewBox((vb) => {
      if (!vb) return vb;
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newW = vb.w / 1.3;
      const newH = vb.h / 1.3;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setViewBox((vb) => {
      if (!vb) return vb;
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newW = Math.min(svgW * 4, vb.w * 1.3);
      const newH = Math.min(svgH * 4, vb.h * 1.3);
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
    });
  }, [svgW, svgH]);

  const resetZoom = useCallback(() => {
    setViewBox({ x: 0, y: 0, w: svgW, h: svgH });
  }, [svgW, svgH]);

  // ---------------------------------------------------------------------------
  // Node click
  // ---------------------------------------------------------------------------

  const handleNodeClick = useCallback((node: PositionedNode) => {
    setSelectedNode((prev) =>
      prev?.id === node.id ? null : { id: node.id, type: node.type },
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const cycles = graphData?.cycles ?? [];

  const viewBoxStr = viewBox
    ? `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`
    : `0 0 ${svgW} ${svgH}`;

  return (
    <div className="flex h-full flex-col space-y-4 overflow-hidden">
      <h1 className="shrink-0 text-2xl font-bold text-slate-900">Dependency Graph</h1>

      {/* Controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {/* Epic filter */}
        <select
          value={epicFilter}
          onChange={(e) => setEpicFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Epics</option>
          {(epics ?? []).map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.id} — {ep.title}
            </option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All statuses</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>

        {/* Dependency type filter */}
        <select
          value={depTypeFilter}
          onChange={(e) => setDepTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All types</option>
          {uniqueDepTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

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
            {/* Zoom controls */}
            <div className="absolute right-3 top-3 z-10 flex flex-col gap-1">
              <button
                onClick={zoomIn}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="Zoom in"
              >
                <ZoomIn size={14} />
              </button>
              <button
                onClick={zoomOut}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="Zoom out"
              >
                <ZoomOut size={14} />
              </button>
              <button
                onClick={resetZoom}
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white shadow-sm hover:bg-slate-50"
                title="Reset zoom"
              >
                <Maximize2 size={14} />
              </button>
            </div>

            {/* SVG */}
            <svg
              ref={svgRef}
              className="h-full w-full cursor-grab active:cursor-grabbing"
              viewBox={viewBoxStr}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <defs>
                <marker
                  id="arrow-resolved"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
                </marker>
                <marker
                  id="arrow-unresolved"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                >
                  <path d="M0,0 L0,6 L8,3 z" fill="#f59e0b" />
                </marker>
              </defs>

              {/* Edges */}
              {filteredEdges.map((edge, i) => {
                const from = nodeMap.get(edge.from);
                const to = nodeMap.get(edge.to);
                if (!from || !to) return null;

                const x1 = from.x + NODE_W / 2;
                const y1 = from.y + NODE_H;
                const x2 = to.x + NODE_W / 2;
                const y2 = to.y;

                const cy1 = y1 + (y2 - y1) / 2;
                const cy2 = y2 - (y2 - y1) / 2;

                const strokeColor = edge.resolved ? '#94a3b8' : '#f59e0b';
                const markerId = edge.resolved ? 'arrow-resolved' : 'arrow-unresolved';

                return (
                  <path
                    key={i}
                    d={`M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={1.5}
                    markerEnd={`url(#${markerId})`}
                    className="cursor-pointer"
                    onMouseEnter={(e) => {
                      const rect = svgRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({
                        visible: true,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        content: `Type: ${edge.type}${edge.resolved ? ' (resolved)' : ' (unresolved)'}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
                  />
                );
              })}

              {/* Nodes */}
              {positionedNodes.map((node) => {
                const colors = getNodeColors(node);
                const dimmed = isCompleted(node.status);
                const isSelected = selectedNode?.id === node.id;
                const depCount = filteredEdges.filter(
                  (e) => e.from === node.id || e.to === node.id,
                ).length;

                return (
                  <g
                    key={node.id}
                    data-node="true"
                    style={{ opacity: dimmed ? 0.45 : 1, cursor: 'pointer' }}
                    onClick={() => handleNodeClick(node)}
                    onMouseEnter={(e) => {
                      const rect = svgRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setTooltip({
                        visible: true,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        content: `${node.title}\nStatus: ${node.status}\nDependencies: ${depCount}`,
                      });
                    }}
                    onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
                  >
                    <rect
                      x={node.x}
                      y={node.y}
                      width={NODE_W}
                      height={NODE_H}
                      rx={6}
                      fill={colors.fill}
                      stroke={colors.stroke}
                      strokeWidth={isSelected ? 3 : 1.5}
                    />
                    <text
                      x={node.x + NODE_W / 2}
                      y={node.y + NODE_H / 2 - 6}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#64748b"
                      fontFamily="monospace"
                    >
                      {node.id.length > 20 ? node.id.slice(0, 18) + '…' : node.id}
                    </text>
                    <text
                      x={node.x + NODE_W / 2}
                      y={node.y + NODE_H / 2 + 8}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#1e293b"
                      fontWeight="500"
                      fontFamily="system-ui, sans-serif"
                    >
                      {node.title.length > 18 ? node.title.slice(0, 16) + '…' : node.title}
                    </text>
                  </g>
                );
              })}

              {/* Empty state */}
              {positionedNodes.length === 0 && (
                <text
                  x={200}
                  y={120}
                  textAnchor="middle"
                  fontSize={14}
                  fill="#94a3b8"
                  fontFamily="system-ui, sans-serif"
                >
                  No nodes to display
                </text>
              )}
            </svg>

            {/* Floating tooltip */}
            {tooltip.visible && (
              <div
                className="pointer-events-none absolute z-20 max-w-xs rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
                style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
              >
                {tooltip.content.split('\n').map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
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
