import { useMemo } from 'react';

import type { HighlightState } from './types.js';

interface EdgeInput {
  source: string;
  target: string;
}

interface UseGraphHighlightResult {
  getNodeHighlight: (nodeId: string) => HighlightState;
  getEdgeHighlight: (source: string, target: string) => HighlightState;
}

/**
 * Computes highlight states for nodes and edges based on the currently
 * selected node.  When nothing is selected every node/edge returns 'none'
 * (components treat that as "render normally").  When a node IS selected the
 * hook walks the dependency graph in both directions (ancestors & descendants)
 * via BFS and classifies every reachable node as 'direct' (one hop) or
 * 'transitive' (two+ hops).  Unreachable nodes stay 'none' which components
 * render as dimmed.
 */
export function useGraphHighlight(
  selectedNodeId: string | null,
  edges: EdgeInput[],
): UseGraphHighlightResult {
  const { nodeHighlights, edgeHighlights } = useMemo(() => {
    const nodeMap = new Map<string, HighlightState>();
    const edgeMap = new Map<string, HighlightState>();

    if (selectedNodeId == null) {
      return { nodeHighlights: nodeMap, edgeHighlights: edgeMap };
    }

    // Build adjacency lists in both directions.
    const forward = new Map<string, Set<string>>(); // node -> outgoing neighbours
    const backward = new Map<string, Set<string>>(); // node -> incoming neighbours

    for (const { source, target } of edges) {
      if (!forward.has(source)) forward.set(source, new Set());
      forward.get(source)!.add(target);

      if (!backward.has(target)) backward.set(target, new Set());
      backward.get(target)!.add(source);
    }

    // Collect direct neighbours (one hop in either direction).
    const directNeighbours = new Set<string>();
    for (const n of forward.get(selectedNodeId) ?? []) directNeighbours.add(n);
    for (const n of backward.get(selectedNodeId) ?? []) directNeighbours.add(n);

    // BFS in one direction starting from the direct neighbours (skipping the
    // selected node itself).  Returns all nodes reachable beyond the first hop.
    const bfs = (adj: Map<string, Set<string>>): Set<string> => {
      const visited = new Set<string>();
      // Seed the BFS with direct neighbours so we can discover nodes at
      // distance >= 2.
      const queue = [...directNeighbours];
      for (const n of queue) visited.add(n);

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adj.get(current) ?? []) {
          if (next === selectedNodeId || visited.has(next)) continue;
          visited.add(next);
          queue.push(next);
        }
      }

      return visited;
    };

    const reachableForward = bfs(forward);
    const reachableBackward = bfs(backward);

    // Merge reachable sets.  Anything reachable but NOT a direct neighbour is
    // transitive.
    const transitiveNodes = new Set<string>();
    for (const n of reachableForward) {
      if (!directNeighbours.has(n)) transitiveNodes.add(n);
    }
    for (const n of reachableBackward) {
      if (!directNeighbours.has(n)) transitiveNodes.add(n);
    }

    // Build node highlight map.
    nodeMap.set(selectedNodeId, 'selected');
    for (const n of directNeighbours) nodeMap.set(n, 'direct');
    for (const n of transitiveNodes) nodeMap.set(n, 'transitive');

    // Build edge highlight map.
    for (const { source, target } of edges) {
      const key = `${source}:${target}`;
      if (source === selectedNodeId || target === selectedNodeId) {
        edgeMap.set(key, 'direct');
      } else {
        const sourceState = nodeMap.get(source);
        const targetState = nodeMap.get(target);
        const isHighlighted =
          sourceState !== undefined && targetState !== undefined;
        edgeMap.set(key, isHighlighted ? 'transitive' : 'none');
      }
    }

    return { nodeHighlights: nodeMap, edgeHighlights: edgeMap };
  }, [selectedNodeId, edges]);

  const getNodeHighlight = useMemo(
    () =>
      (nodeId: string): HighlightState =>
        nodeHighlights.get(nodeId) ?? 'none',
    [nodeHighlights],
  );

  const getEdgeHighlight = useMemo(
    () =>
      (source: string, target: string): HighlightState =>
        edgeHighlights.get(`${source}:${target}`) ?? 'none',
    [edgeHighlights],
  );

  return { getNodeHighlight, getEdgeHighlight };
}
