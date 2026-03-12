/**
 * Hook that uses ELK (Eclipse Layout Kernel) to compute a compound/nested
 * graph layout for React Flow.
 *
 * Hierarchy:
 *   Epic (group) -> Ticket (group) -> Stage (leaf)
 *
 * React Flow receives nested nodes via the `parentId` field, with positions
 * relative to their parent.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { ELK as ELKApi, ElkNode } from 'elkjs';

import type {
  GraphNode,
  GraphEdge,
  GraphNodeData,
  GraphEdgeData,
} from './types.js';

// ---------------------------------------------------------------------------
// ELK instance (lazy singleton to avoid re-import on each render)
// ---------------------------------------------------------------------------

let elkInstance: ELKApi | null = null;

async function getElk(): Promise<ELKApi> {
  if (elkInstance) return elkInstance;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('elkjs/lib/elk.bundled.js') as any;
  const Ctor = mod.default ?? mod;
  elkInstance = new Ctor() as ELKApi;
  return elkInstance;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Leaf (stage) node dimensions. */
const STAGE_WIDTH = 160;
const STAGE_HEIGHT = 40;

/** Padding inside group containers. */
const GROUP_PADDING = 40;
/** Extra top padding for epic containers (room for label). */
const EPIC_EXTRA_TOP = 30;

/** Map GraphNode type to the React Flow custom node type name. */
const RF_NODE_TYPE: Record<GraphNode['type'], string> = {
  epic: 'epicNode',
  ticket: 'ticketNode',
  stage: 'stageNode',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a stable fingerprint for dependency comparison. */
function fingerprint(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nIds = nodes.map((n) => n.id).sort().join(',');
  const eIds = edges.map((e) => `${e.from}->${e.to}:${e.resolved}`).sort().join(',');
  return `${nIds}|${eIds}`;
}

/**
 * Recursively walk the laid-out ELK tree and collect absolute positions for
 * every node. Returns a map of elkNodeId -> { x, y, width, height }.
 */
function collectPositions(
  elkNode: ElkNode,
  offsetX: number,
  offsetY: number,
  out: Map<string, { x: number; y: number; width: number; height: number }>,
): void {
  const x = (elkNode.x ?? 0) + offsetX;
  const y = (elkNode.y ?? 0) + offsetY;
  const w = elkNode.width ?? 0;
  const h = elkNode.height ?? 0;
  out.set(elkNode.id, { x, y, width: w, height: h });
  for (const child of elkNode.children ?? []) {
    collectPositions(child, x, y, out);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseElkLayoutResult {
  nodes: Node[];
  edges: Edge[];
  isLayouting: boolean;
}

export function useElkLayout(
  graphNodes: GraphNode[],
  graphEdges: GraphEdge[],
  criticalPath: string[] = [],
): UseElkLayoutResult {
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const [isLayouting, setIsLayouting] = useState(false);

  const fp = useMemo(() => fingerprint(graphNodes, graphEdges), [graphNodes, graphEdges]);
  const prevFp = useRef<string>('');

  useEffect(() => {
    if (graphNodes.length === 0) {
      setRfNodes([]);
      setRfEdges([]);
      setIsLayouting(false);
      return;
    }

    if (fp === prevFp.current) return;
    prevFp.current = fp;

    setIsLayouting(true);

    const criticalSet = new Set(criticalPath);

    // Build lookup maps
    const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));
    const nodeIdSet = new Set(graphNodes.map((n) => n.id));

    // Determine which nodes are blocked (have unresolved incoming edges)
    const blockedSet = new Set<string>();
    for (const e of graphEdges) {
      if (!e.resolved && nodeIdSet.has(e.to)) {
        blockedSet.add(e.to);
      }
    }

    // ------------------------------------------------------------------
    // Build hierarchical ELK graph
    // ------------------------------------------------------------------

    // Group nodes by type
    const epicNodes = graphNodes.filter((n) => n.type === 'epic');
    const ticketNodes = graphNodes.filter((n) => n.type === 'ticket');
    const stageNodes = graphNodes.filter((n) => n.type === 'stage');

    // Build children maps
    const ticketsByEpic = new Map<string, GraphNode[]>();
    const stagesByTicket = new Map<string, GraphNode[]>();
    const orphanTickets: GraphNode[] = [];
    const orphanStages: GraphNode[] = [];

    for (const t of ticketNodes) {
      if (t.epicId && nodeIdSet.has(t.epicId)) {
        const list = ticketsByEpic.get(t.epicId) ?? [];
        list.push(t);
        ticketsByEpic.set(t.epicId, list);
      } else {
        orphanTickets.push(t);
      }
    }

    for (const s of stageNodes) {
      if (s.ticketId && nodeIdSet.has(s.ticketId)) {
        const list = stagesByTicket.get(s.ticketId) ?? [];
        list.push(s);
        stagesByTicket.set(s.ticketId, list);
      } else {
        orphanStages.push(s);
      }
    }

    // Helper: create ELK node for a stage (leaf)
    const makeStageElk = (s: GraphNode): ElkNode => ({
      id: s.id,
      width: STAGE_WIDTH,
      height: STAGE_HEIGHT,
    });

    // Helper: create ELK node for a ticket (group or leaf)
    const makeTicketElk = (t: GraphNode): ElkNode => {
      const stages = stagesByTicket.get(t.id) ?? [];
      if (stages.length === 0) {
        // Ticket with no stage children — treat as leaf
        return { id: t.id, width: 180, height: 48 };
      }
      return {
        id: t.id,
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.padding': `[top=${GROUP_PADDING},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
          'elk.spacing.nodeNode': '20',
          'elk.layered.spacing.nodeNodeBetweenLayers': '40',
        },
        children: stages.map(makeStageElk),
      };
    };

    // Helper: create ELK node for an epic (group or leaf)
    const makeEpicElk = (e: GraphNode): ElkNode => {
      const tickets = ticketsByEpic.get(e.id) ?? [];
      if (tickets.length === 0) {
        return { id: e.id, width: 200, height: 56 };
      }
      return {
        id: e.id,
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.padding': `[top=${GROUP_PADDING + EPIC_EXTRA_TOP},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
          'elk.spacing.nodeNode': '30',
          'elk.layered.spacing.nodeNodeBetweenLayers': '50',
        },
        children: tickets.map(makeTicketElk),
      };
    };

    // Root children: epics, orphan tickets, orphan stages
    const rootChildren: ElkNode[] = [
      ...epicNodes.map(makeEpicElk),
      ...orphanTickets.map(makeTicketElk),
      ...orphanStages.map(makeStageElk),
    ];

    // Edges at root level (ELK handles cross-hierarchy edges)
    const elkEdges = graphEdges.map((e, i) => ({
      id: `e-${e.from}-${e.to}-${i}`,
      sources: [e.from],
      targets: [e.to],
    }));

    const elkGraph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '50',
        'elk.edgeRouting': 'SPLINES',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      },
      children: rootChildren,
      edges: elkEdges,
    };

    let cancelled = false;

    getElk()
      .then((elk) => elk.layout(elkGraph))
      .then((layouted: ElkNode) => {
        if (cancelled) return;

        // Collect absolute positions for all nodes in the tree
        const absPositions = new Map<string, { x: number; y: number; width: number; height: number }>();
        for (const child of layouted.children ?? []) {
          collectPositions(child, 0, 0, absPositions);
        }

        // Build React Flow nodes with proper parentId and relative positions
        const nodes: Node[] = [];

        // Determine parent mapping for React Flow
        const rfParentMap = new Map<string, string>();
        for (const t of ticketNodes) {
          if (t.epicId && nodeIdSet.has(t.epicId) && ticketsByEpic.has(t.epicId)) {
            rfParentMap.set(t.id, t.epicId);
          }
        }
        for (const s of stageNodes) {
          if (s.ticketId && nodeIdSet.has(s.ticketId) && stagesByTicket.has(s.ticketId)) {
            rfParentMap.set(s.id, s.ticketId);
          }
        }

        for (const gn of graphNodes) {
          const pos = absPositions.get(gn.id);
          if (!pos) continue;

          const parentId = rfParentMap.get(gn.id);
          const parentPos = parentId ? absPositions.get(parentId) : undefined;

          // Position relative to parent (or absolute if no parent)
          const x = parentPos ? pos.x - parentPos.x : pos.x;
          const y = parentPos ? pos.y - parentPos.y : pos.y;

          const isGroup = (gn.type === 'epic' && (ticketsByEpic.get(gn.id)?.length ?? 0) > 0)
            || (gn.type === 'ticket' && (stagesByTicket.get(gn.id)?.length ?? 0) > 0);

          const data: GraphNodeData = {
            id: gn.id,
            type: gn.type,
            title: gn.title,
            status: gn.status,
            highlightState: 'none',
            isBlocked: blockedSet.has(gn.id),
          };

          const node: Node = {
            id: gn.id,
            type: RF_NODE_TYPE[gn.type],
            position: { x, y },
            data: data as unknown as Record<string, unknown>,
          };

          if (parentId) {
            node.parentId = parentId;
          }

          if (isGroup) {
            node.style = { width: pos.width, height: pos.height };
          } else {
            node.width = pos.width || undefined;
            node.height = pos.height || undefined;
          }

          nodes.push(node);
        }

        // Sort so parents come before children in the array (React Flow requirement)
        const nodeOrder = new Map<string, number>();
        nodeOrder.set('epic', 0);
        nodeOrder.set('ticket', 1);
        nodeOrder.set('stage', 2);
        nodes.sort((a, b) => {
          const aType = (a.data as Record<string, unknown>).type as string;
          const bType = (b.data as Record<string, unknown>).type as string;
          return (nodeOrder.get(aType) ?? 0) - (nodeOrder.get(bType) ?? 0);
        });

        // Build edges with REVERSED direction:
        // Arrow goes FROM dependent TO dependency
        const edges: Edge[] = graphEdges.map((e, i) => {
          const data: GraphEdgeData = {
            type: 'depends_on',
            resolved: e.resolved,
            cross_repo: false,
            critical: criticalSet.has(e.from) && criticalSet.has(e.to),
            highlightState: 'none',
          };
          return {
            id: `e-${e.from}-${e.to}-${i}`,
            source: e.to,
            target: e.from,
            type: 'dependencyEdge',
            data: data as unknown as Record<string, unknown>,
          };
        });

        setRfNodes(nodes);
        setRfEdges(edges);
        setIsLayouting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fp, graphNodes, graphEdges, criticalPath]);

  return { nodes: rfNodes, edges: rfEdges, isLayouting };
}
