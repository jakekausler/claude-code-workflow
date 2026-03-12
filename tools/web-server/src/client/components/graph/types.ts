/**
 * Shared type definitions for the React Flow dependency graph.
 */

// Re-export API types so graph components import from one place.
export type { GraphNode, GraphEdge, GraphResponse } from '../../api/hooks.js';

// ---------------------------------------------------------------------------
// React Flow node data
// ---------------------------------------------------------------------------

export type GraphNodeType = 'epic' | 'ticket' | 'stage';

/** Data payload carried by every React Flow node in the graph. */
export interface GraphNodeData {
  id: string;
  type: GraphNodeType;
  title: string;
  status: string;
  repo?: string;
  highlightState: HighlightState;
  /** True when any node in the graph is selected (used to decide dimming). */
  hasSelection?: boolean;
  /** True when this node has any unresolved incoming dependency. */
  isBlocked?: boolean;
}

// ---------------------------------------------------------------------------
// Highlight state
// ---------------------------------------------------------------------------

/** Visual highlight applied to nodes and edges during selection. */
export type HighlightState = 'selected' | 'direct' | 'transitive' | 'none';

// ---------------------------------------------------------------------------
// React Flow edge data
// ---------------------------------------------------------------------------

/** Data payload carried by every React Flow edge in the graph. */
export interface GraphEdgeData {
  type: 'depends_on';
  resolved: boolean;
  cross_repo?: boolean;
  critical?: boolean;
  highlightState: HighlightState;
  /** True when any node in the graph is selected (used to decide dimming). */
  hasSelection?: boolean;
  /** Pre-computed edge path points from ELK layout (absolute coordinates). */
  elkPoints?: Array<{ x: number; y: number }>;
}
