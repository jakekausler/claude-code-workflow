// scripts/svg-to-dot.ts
import { readFileSync } from 'node:fs';
import { DOMParser } from 'xmldom';

interface Point {
  x: number;
  y: number;
}

interface ParsedNode {
  id: string;
  label: string;
  center: Point;
  shape: 'box' | 'diamond' | 'record';
  width: number;
  height: number;
}

interface ParsedEdge {
  startPoint: Point;
  endPoint: Point;
  sourceId?: string;
  targetId?: string;
  label?: string;
}

interface OrphanText {
  text: string;
  center: Point;
}

function main(): void {
  const svgPath = process.argv[2];
  if (!svgPath) {
    console.error('Usage: npx tsx scripts/svg-to-dot.ts <path-to-svg>');
    process.exit(1);
  }

  const svgContent = readFileSync(svgPath, 'utf-8');
  const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');

  const nodes = extractNodes(doc);
  const edges = extractEdges(doc);
  const orphanTexts = extractOrphanTexts(doc, nodes);

  matchEdgesToNodes(edges, nodes);
  assignEdgeLabels(edges, orphanTexts);

  console.log(formatDot(nodes, edges));
}

main();
