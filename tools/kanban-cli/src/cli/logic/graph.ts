// ---------- Input data shapes ----------

export interface GraphEpicRow {
  id: string;
  title: string;
  status: string;
  repo?: string;
}

export interface GraphTicketRow {
  id: string;
  epic_id: string;
  title: string;
  status: string;
  repo?: string;
}

export interface GraphStageRow {
  id: string;
  ticket_id: string;
  epic_id: string;
  title: string;
  status: string;
  repo?: string;
}

export interface GraphDependencyRow {
  id: number;
  from_id: string;
  to_id: string;
  from_type: string;
  to_type: string;
  resolved: boolean;
  repo?: string;
}

// ---------- Output types ----------

export interface GraphNode {
  id: string;
  type: 'epic' | 'ticket' | 'stage';
  status: string;
  title: string;
  repo?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'depends_on';
  resolved: boolean;
  cross_repo?: boolean;
}

export interface GraphOutput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: string[][];
  critical_path: string[];
  repos?: string[];
}

export interface GraphFilters {
  epic?: string;
  ticket?: string;
}

export interface BuildGraphInput {
  epics: GraphEpicRow[];
  tickets: GraphTicketRow[];
  stages: GraphStageRow[];
  dependencies: GraphDependencyRow[];
  filters?: GraphFilters;
  global?: boolean;
  repos?: string[];
}

// ---------- Cycle detection (Tarjan's algorithm for SCCs) ----------

function findCycles(adjacency: Map<string, string[]>, nodeIds: Set<string>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const cycles: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adjacency.get(v) || [];
    for (const w of neighbors) {
      if (!nodeIds.has(w)) continue; // skip refs to nodes not in our set
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);

      // Only report components with more than 1 node as cycles
      if (component.length > 1) {
        cycles.push(component.reverse());
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) {
      strongConnect(id);
    }
  }

  return cycles;
}

// ---------- Critical path (longest chain of unresolved deps) ----------

function computeCriticalPath(
  adjacency: Map<string, string[]>,
  nodeIds: Set<string>,
): string[] {
  // adjacency is from_id -> [to_id] for unresolved deps only.
  // We want the longest path in this DAG.
  // Use DFS with memoization to find longest path from each node.
  // Track visiting set to handle cycles gracefully (skip back-edges).

  const memo = new Map<string, string[]>();
  const visiting = new Set<string>();

  function longestFrom(node: string): string[] {
    if (memo.has(node)) return memo.get(node)!;
    if (visiting.has(node)) return []; // cycle detected, stop recursion

    visiting.add(node);
    const neighbors = adjacency.get(node) || [];
    let best: string[] = [];
    for (const next of neighbors) {
      if (!nodeIds.has(next)) continue;
      const sub = longestFrom(next);
      if (sub.length > best.length) {
        best = sub;
      }
    }

    const result = [...best, node];
    visiting.delete(node);
    memo.set(node, result);
    return result;
  }

  let longest: string[] = [];
  for (const id of nodeIds) {
    const path = longestFrom(id);
    if (path.length > longest.length) {
      longest = path;
    }
  }

  // Only return critical path if there are actual unresolved deps
  return longest.length > 1 ? longest : [];
}

// ---------- Core logic ----------

export function buildGraph(input: BuildGraphInput): GraphOutput {
  const { epics, tickets, stages, dependencies, filters, global: isGlobal, repos } = input;

  // Apply filters
  let filteredEpics = epics;
  let filteredTickets = tickets;
  let filteredStages = stages;

  if (filters?.epic) {
    filteredEpics = filteredEpics.filter((e) => e.id === filters.epic);
    filteredTickets = filteredTickets.filter((t) => t.epic_id === filters.epic);
    filteredStages = filteredStages.filter((s) => s.epic_id === filters.epic);
  }
  if (filters?.ticket) {
    filteredTickets = filteredTickets.filter((t) => t.id === filters.ticket);
    filteredStages = filteredStages.filter((s) => s.ticket_id === filters.ticket);
  }

  // Build nodes
  const nodes: GraphNode[] = [];
  const nodeIdSet = new Set<string>();
  // Map node ID -> repo for cross-repo edge detection
  const nodeToRepo = new Map<string, string | undefined>();

  for (const epic of filteredEpics) {
    const node: GraphNode = { id: epic.id, type: 'epic', status: epic.status, title: epic.title };
    if (isGlobal && epic.repo) {
      node.repo = epic.repo;
    }
    nodes.push(node);
    nodeIdSet.add(epic.id);
    nodeToRepo.set(epic.id, epic.repo);
  }
  for (const ticket of filteredTickets) {
    const node: GraphNode = { id: ticket.id, type: 'ticket', status: ticket.status, title: ticket.title };
    if (isGlobal && ticket.repo) {
      node.repo = ticket.repo;
    }
    nodes.push(node);
    nodeIdSet.add(ticket.id);
    nodeToRepo.set(ticket.id, ticket.repo);
  }
  for (const stage of filteredStages) {
    const node: GraphNode = { id: stage.id, type: 'stage', status: stage.status, title: stage.title };
    if (isGlobal && stage.repo) {
      node.repo = stage.repo;
    }
    nodes.push(node);
    nodeIdSet.add(stage.id);
    nodeToRepo.set(stage.id, stage.repo);
  }

  // Build edges (only for deps where both from and to are in our node set)
  const edges: GraphEdge[] = [];
  const unresolvedAdjacency = new Map<string, string[]>();
  const allAdjacency = new Map<string, string[]>();

  for (const dep of dependencies) {
    if (!nodeIdSet.has(dep.from_id) && !nodeIdSet.has(dep.to_id)) continue;

    const edge: GraphEdge = {
      from: dep.from_id,
      to: dep.to_id,
      type: 'depends_on',
      resolved: dep.resolved,
    };

    // Mark cross-repo edges in global mode
    if (isGlobal) {
      const fromRepo = nodeToRepo.get(dep.from_id);
      const toRepo = nodeToRepo.get(dep.to_id);
      if (fromRepo && toRepo && fromRepo !== toRepo) {
        edge.cross_repo = true;
      }
    }

    edges.push(edge);

    // Build adjacency for all deps (for cycle detection)
    const allNeighbors = allAdjacency.get(dep.from_id) || [];
    allNeighbors.push(dep.to_id);
    allAdjacency.set(dep.from_id, allNeighbors);

    // Build adjacency for unresolved deps only (for critical path)
    if (!dep.resolved) {
      const neighbors = unresolvedAdjacency.get(dep.from_id) || [];
      neighbors.push(dep.to_id);
      unresolvedAdjacency.set(dep.from_id, neighbors);
    }
  }

  // Detect cycles using all dependencies
  const allNodeIds = new Set([...nodeIdSet]);
  // Add dep targets that might not be in our filtered set but are part of cycles
  for (const dep of dependencies) {
    allNodeIds.add(dep.from_id);
    allNodeIds.add(dep.to_id);
  }
  const cycles = findCycles(allAdjacency, allNodeIds);

  // Compute critical path using unresolved deps only
  const criticalPath = computeCriticalPath(unresolvedAdjacency, nodeIdSet);

  const output: GraphOutput = { nodes, edges, cycles, critical_path: criticalPath };

  // Add repos array in global mode
  if (isGlobal && repos) {
    output.repos = repos;
  }

  return output;
}
