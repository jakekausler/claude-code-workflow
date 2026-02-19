// scripts/svg-to-dot.ts
import { readFileSync } from 'node:fs';
import { DOMParser } from 'xmldom';

export interface Point {
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

export function parseTranslate(transform: string | null): Point | null {
  if (!transform) return null;
  const match = transform.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!match) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

export function getPathStartPoint(d: string): Point {
  const match = d.match(/^M\s+([-\d.]+)\s+([-\d.]+)/);
  if (!match) throw new Error(`Cannot parse path start: ${d}`);
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

export function getPathEndPoint(d: string): Point {
  const segments = d.match(/[MLCQAZ][^MLCQAZ]*/gi) || [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].trim();
    const cmd = seg[0].toUpperCase();
    if (cmd === 'Z') continue;
    const nums = seg.slice(1).trim().match(/-?[\d.]+/g);
    if (!nums || nums.length < 2) continue;
    return { x: parseFloat(nums[nums.length - 2]), y: parseFloat(nums[nums.length - 1]) };
  }
  throw new Error(`Cannot parse path end: ${d}`);
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

// Only run when executed directly (not when imported)
const isDirectRun = process.argv[1]?.endsWith('svg-to-dot.ts') || process.argv[1]?.endsWith('svg-to-dot.js');
if (isDirectRun) {
  main();
}
