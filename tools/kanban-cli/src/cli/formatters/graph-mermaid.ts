import type { GraphOutput, GraphNode, GraphEdge } from '../logic/graph.js';

/**
 * Convert an entity ID to a valid Mermaid node ID (alphanumeric + underscores only).
 * Examples:
 *   EPIC-001        -> E001
 *   TICKET-001-001  -> T001_001
 *   STAGE-001-001-001 -> S001_001_001
 *   arbitrary-id    -> arbitrary_id
 */
export function sanitizeNodeId(id: string): string {
  // Known prefixes: replace with single-letter abbreviation
  if (id.startsWith('EPIC-')) {
    return 'E' + id.slice('EPIC-'.length).replace(/-/g, '_');
  }
  if (id.startsWith('TICKET-')) {
    return 'T' + id.slice('TICKET-'.length).replace(/-/g, '_');
  }
  if (id.startsWith('STAGE-')) {
    return 'S' + id.slice('STAGE-'.length).replace(/-/g, '_');
  }
  // Fallback: replace all non-alphanumeric chars with underscores
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Extract the epic ID that a ticket or stage belongs to, based on ID convention.
 * TICKET-001-001      -> EPIC-001
 * STAGE-001-001-001   -> EPIC-001
 * Returns undefined if the ID doesn't follow the convention.
 */
function inferEpicId(node: GraphNode): string | undefined {
  if (node.type === 'ticket') {
    const match = node.id.match(/^TICKET-(\d+)/);
    if (match) return `EPIC-${match[1]}`;
  }
  if (node.type === 'stage') {
    const match = node.id.match(/^STAGE-(\d+)/);
    if (match) return `EPIC-${match[1]}`;
  }
  return undefined;
}

/** Map a status string to a fill color for Mermaid style directives. */
function statusColor(status: string): { fill: string; color: string } {
  const normalized = status.toLowerCase();
  if (normalized === 'complete' || normalized === 'done') {
    return { fill: '#27ae60', color: '#fff' };
  }
  if (normalized === 'not started') {
    return { fill: '#bdc3c7', color: '#2c3e50' };
  }
  if (normalized === 'design') {
    return { fill: '#9b59b6', color: '#fff' };
  }
  if (normalized === 'build') {
    return { fill: '#3498db', color: '#fff' };
  }
  if (normalized === 'review' || normalized === 'pr created') {
    return { fill: '#f39c12', color: '#fff' };
  }
  if (normalized === 'in progress') {
    return { fill: '#2980b9', color: '#fff' };
  }
  // Default for unknown statuses
  return { fill: '#ecf0f1', color: '#2c3e50' };
}

/** Status indicator emoji for node labels. */
function statusIndicator(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'complete' || normalized === 'done') return 'Complete';
  if (normalized === 'not started') return 'Not Started';
  return status;
}

/**
 * Build the Mermaid node definition string based on node type.
 *   Epic:   E001[["EPIC-001<br/>Title"]]
 *   Ticket: T001_001["TICKET-001-001<br/>Title"]
 *   Stage:  S001_001_001("STAGE-001-001-001<br/>Title<br/>status")
 */
function nodeDefinition(node: GraphNode): string {
  const safeId = sanitizeNodeId(node.id);
  const indicator = statusIndicator(node.status);

  switch (node.type) {
    case 'epic':
      return `${safeId}[["${node.id}<br/>${node.title}"]]`;
    case 'ticket':
      return `${safeId}["${node.id}<br/>${node.title}"]`;
    case 'stage':
      return `${safeId}("${node.id}<br/>${node.title}<br/>${indicator}")`;
    default:
      return `${safeId}["${node.id}<br/>${node.title}"]`;
  }
}

/**
 * Format a GraphOutput as a Mermaid diagram string.
 *
 * Produces a `graph TD` diagram with:
 * - Subgraphs grouping tickets/stages under their epic
 * - Shaped nodes by type (stadium for epics, rect for tickets, rounded for stages)
 * - Colored nodes by status
 * - Solid arrows for resolved deps, dashed arrows for unresolved
 * - Thick arrows for critical path edges
 * - Comments noting any detected cycles
 */
export function formatGraphAsMermaid(graph: GraphOutput): string {
  const { nodes, edges, cycles, critical_path } = graph;
  const lines: string[] = ['graph TD'];

  if (nodes.length === 0) {
    return lines.join('\n');
  }

  // Build lookup maps
  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // Build critical path edge set for O(1) lookup
  const criticalEdges = new Set<string>();
  for (let i = 0; i < critical_path.length - 1; i++) {
    // Critical path is ordered [first, ..., last], edges go from later to earlier
    // but we need to match edges as they appear in the graph.
    // The critical path lists nodes in dependency order, so edge direction
    // matches from_id -> to_id in the edges array.
    // We store both directions to be safe.
    criticalEdges.add(`${critical_path[i]}|${critical_path[i + 1]}`);
    criticalEdges.add(`${critical_path[i + 1]}|${critical_path[i]}`);
  }

  // Group nodes by epic for subgraph rendering
  const epicNodes = nodes.filter((n) => n.type === 'epic');
  const epicChildMap = new Map<string, GraphNode[]>(); // epicId -> children
  const ungroupedNodes: GraphNode[] = [];

  // Initialize epic groups
  for (const epic of epicNodes) {
    epicChildMap.set(epic.id, []);
  }

  // Assign tickets and stages to their epic groups
  for (const node of nodes) {
    if (node.type === 'epic') continue;
    const epicId = inferEpicId(node);
    if (epicId && epicChildMap.has(epicId)) {
      epicChildMap.get(epicId)!.push(node);
    } else {
      ungroupedNodes.push(node);
    }
  }

  // Render subgraphs for each epic
  for (const epic of epicNodes) {
    const children = epicChildMap.get(epic.id) || [];
    const safeEpicId = sanitizeNodeId(epic.id);
    lines.push(`    subgraph ${safeEpicId} ["${epic.id}: ${epic.title}"]`);
    // Epic node itself inside the subgraph
    lines.push(`        ${nodeDefinition(epic)}`);
    for (const child of children) {
      lines.push(`        ${nodeDefinition(child)}`);
    }
    lines.push('    end');
  }

  // Render ungrouped nodes
  for (const node of ungroupedNodes) {
    lines.push(`    ${nodeDefinition(node)}`);
  }

  // Render edges
  for (const edge of edges) {
    const fromSafe = sanitizeNodeId(edge.from);
    const toSafe = sanitizeNodeId(edge.to);
    const isCritical = criticalEdges.has(`${edge.from}|${edge.to}`);

    if (isCritical) {
      lines.push(`    ${fromSafe} ==> ${toSafe}`);
    } else if (edge.resolved) {
      lines.push(`    ${fromSafe} --> ${toSafe}`);
    } else {
      lines.push(`    ${fromSafe} -.-> ${toSafe}`);
    }
  }

  // Render style directives
  for (const node of nodes) {
    const safeId = sanitizeNodeId(node.id);
    const { fill, color } = statusColor(node.status);
    lines.push(`    style ${safeId} fill:${fill},color:${color}`);
  }

  // Add cycle comments
  if (cycles.length > 0) {
    lines.push('');
    for (const cycle of cycles) {
      const cycleIds = cycle.map((id) => sanitizeNodeId(id)).join(' -> ');
      lines.push(`    %% Cycle detected: ${cycleIds}`);
    }
  }

  return lines.join('\n');
}
