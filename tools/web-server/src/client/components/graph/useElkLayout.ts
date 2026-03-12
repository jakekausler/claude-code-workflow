/**
 * Hook that uses ELK (Eclipse Layout Kernel) to compute graph positions
 * for React Flow nodes and edges.
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
  // Dynamic import for the browser-compatible bundled build.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import('elkjs/lib/elk.bundled.js') as any;
  const Ctor = mod.default ?? mod;
  elkInstance = new Ctor() as ELKApi;
  return elkInstance;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NODE_SIZES: Record<GraphNode['type'], { width: number; height: number }> = {
  epic: { width: 200, height: 56 },
  ticket: { width: 180, height: 48 },
  stage: { width: 160, height: 40 },
};

/** Map GraphNode type to the React Flow custom node type name. */
const RF_NODE_TYPE: Record<GraphNode['type'], string> = {
  epic: 'epicNode',
  ticket: 'ticketNode',
  stage: 'stageNode',
};

/** Layer index per node type - lower number = higher in the layout. */
const LAYER_CONSTRAINT: Record<GraphNode['type'], number> = {
  epic: 0,
  ticket: 1,
  stage: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a stable fingerprint of the node/edge arrays for dependency comparison. */
function fingerprint(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nIds = nodes.map((n) => n.id).sort().join(',');
  const eIds = edges.map((e) => `${e.from}->${e.to}`).sort().join(',');
  return `${nIds}|${eIds}`;
}

/**
 * Build a mapping from ticket id to a partition index based on its parent epic.
 * An edge from an epic to a non-epic node establishes the relationship.
 */
function buildEpicPartitionMap(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Map<string, number> {
  const epicIds = new Set(nodes.filter((n) => n.type === 'epic').map((n) => n.id));
  const epicToPartition = new Map<string, number>();
  let partitionIdx = 0;
  for (const id of epicIds) {
    epicToPartition.set(id, partitionIdx++);
  }

  const ticketPartition = new Map<string, number>();
  for (const edge of edges) {
    if (epicIds.has(edge.from) && !epicIds.has(edge.to)) {
      const partition = epicToPartition.get(edge.from);
      if (partition !== undefined) {
        ticketPartition.set(edge.to, partition);
      }
    }
  }
  return ticketPartition;
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

  // Track the fingerprint so we only recompute when the data actually changes.
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
    const ticketPartition = buildEpicPartitionMap(graphNodes, graphEdges);

    const elkGraph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.spacing.nodeNode': '40',
        'elk.edgeRouting': 'SPLINES',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      },
      children: graphNodes.map((n) => {
        const size = NODE_SIZES[n.type];
        const opts: Record<string, string> = {
          'elk.layered.layerConstraint': String(LAYER_CONSTRAINT[n.type]),
        };
        const partition = ticketPartition.get(n.id);
        if (partition !== undefined) {
          opts['elk.partitioning.partition'] = String(partition);
        }
        return {
          id: n.id,
          width: size.width,
          height: size.height,
          layoutOptions: opts,
        };
      }),
      edges: graphEdges.map((e, i) => ({
        id: `e-${e.from}-${e.to}-${i}`,
        sources: [e.from],
        targets: [e.to],
      })),
    };

    let cancelled = false;

    getElk()
      .then((elk) => elk.layout(elkGraph))
      .then((layouted: ElkNode) => {
        if (cancelled) return;

        const nodeMap = new Map(graphNodes.map((n) => [n.id, n]));

        const nodes: Node[] = (layouted.children ?? []).map((elkChild) => {
          const src = nodeMap.get(elkChild.id)!;
          const size = NODE_SIZES[src.type];
          const data: GraphNodeData = {
            id: src.id,
            type: src.type,
            title: src.title,
            status: src.status,
            highlightState: 'none',
          };
          return {
            id: elkChild.id,
            type: RF_NODE_TYPE[src.type],
            position: { x: elkChild.x ?? 0, y: elkChild.y ?? 0 },
            data: data as unknown as Record<string, unknown>,
            width: size.width,
            height: size.height,
          };
        });

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
            source: e.from,
            target: e.to,
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
