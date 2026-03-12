import { memo } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import type { GraphEdgeData } from '../types.js';

/** Derive stroke color and width from edge data. */
function edgeStyle(d: GraphEdgeData): { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  let stroke = '#94a3b8'; // resolved default (gray)
  let strokeWidth = 1.5;
  let strokeDasharray: string | undefined;

  if (d.critical) {
    stroke = '#ef4444';
    strokeWidth = 2.5;
  } else if (!d.resolved) {
    stroke = '#f59e0b';
    strokeWidth = 2;
  }

  if (d.cross_repo) {
    strokeDasharray = '6 3';
  }

  // Highlight adjustments
  if (d.highlightState === 'direct') {
    strokeWidth += 1;
  }

  return { stroke, strokeWidth, strokeDasharray };
}

function tooltipLabel(d: GraphEdgeData): string {
  const parts: string[] = [`Type: ${d.type}`];
  parts.push(`Resolved: ${d.resolved ? 'yes' : 'no'}`);
  if (d.critical) parts.push('Critical');
  if (d.cross_repo) parts.push('Cross-repo');
  return parts.join(' | ');
}

/** Build an SVG path string from ELK-computed points. */
function buildElkPath(points: Array<{ x: number; y: number }>): string {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function DependencyEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    data,
  } = props;

  const edgeData = data as unknown as GraphEdgeData;

  // Use ELK-computed path if available, otherwise fall back to straight line
  const edgePath = edgeData.elkPoints && edgeData.elkPoints.length >= 2
    ? buildElkPath(edgeData.elkPoints)
    : `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;

  const style = edgeStyle(edgeData);
  const dimmed = edgeData.hasSelection && edgeData.highlightState === 'none';

  return (
    <g opacity={dimmed ? 0.15 : 1}>
      <title>{tooltipLabel(edgeData)}</title>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          strokeDasharray: style.strokeDasharray,
        }}
      />
    </g>
  );
}

export default memo(DependencyEdge);
