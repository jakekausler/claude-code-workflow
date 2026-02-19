// scripts/svg-to-dot.ts
import { readFileSync } from 'node:fs';
import { DOMParser } from 'xmldom';

export interface Point {
  x: number;
  y: number;
}

export interface ParsedNode {
  id: string;
  label: string;
  center: Point;
  shape: 'box' | 'diamond' | 'record';
  width: number;
  height: number;
}

export interface ParsedEdge {
  startPoint: Point;
  endPoint: Point;
  sourceId?: string;
  targetId?: string;
  label?: string;
}

export interface OrphanText {
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

export function extractNodes(doc: Document): ParsedNode[] {
  const allGroups = Array.from(doc.getElementsByTagName('g'));

  interface GroupInfo {
    el: Element;
    translate: Point;
    width: number;
    height: number;
  }

  const shapeGroups: GroupInfo[] = [];
  const textGroups: (GroupInfo & { texts: string[] })[] = [];

  for (const g of allGroups) {
    const transform = g.getAttribute('transform');
    const widthAttr = g.getAttribute('width');
    if (!transform || !widthAttr) continue;

    const translate = parseTranslate(transform);
    if (!translate) continue;

    const width = parseFloat(widthAttr);
    const heightAttr = g.getAttribute('height');
    const height = heightAttr ? parseFloat(heightAttr) : 0;

    if (width === 0 && height === 0) continue;

    // Check if this is a shape group
    const hasShapeRect = hasDescendantWithClass(g, 'rect', 'shape-element');
    const hasContainerRect = hasStyledRect(g);
    const hasDiamond = hasDiamondShape(g);

    if (hasShapeRect || hasContainerRect || hasDiamond) {
      shapeGroups.push({ el: g, translate, width, height });
      continue;
    }

    // Check if this is a text group (has text descendants)
    const textEls = g.getElementsByTagName('text');
    if (textEls.length > 0) {
      const texts: string[] = [];
      for (let i = 0; i < textEls.length; i++) {
        const t = textEls[i].textContent?.trim();
        if (t) texts.push(t);
      }
      if (texts.length > 0) {
        textGroups.push({ el: g, translate, width, height, texts });
      }
    }
  }

  // Pair shape groups with text groups at same translate position
  const nodes: ParsedNode[] = [];
  const usedTextGroups = new Set<number>();

  for (const shape of shapeGroups) {
    let label = '';
    // Find matching text group (same translate within tolerance)
    for (let i = 0; i < textGroups.length; i++) {
      if (usedTextGroups.has(i)) continue;
      const tg = textGroups[i];
      if (Math.abs(tg.translate.x - shape.translate.x) < 1 &&
          Math.abs(tg.translate.y - shape.translate.y) < 1) {
        label = tg.texts.join('\\n');
        usedTextGroups.add(i);
        break;
      }
    }

    // If no paired text group, check for text within the shape group itself
    if (!label) {
      const textEls = shape.el.getElementsByTagName('text');
      const texts: string[] = [];
      for (let i = 0; i < textEls.length; i++) {
        const t = textEls[i].textContent?.trim();
        if (t) texts.push(t);
      }
      label = texts.join('\\n');
    }

    if (!label) continue; // Skip unlabeled groups

    const shapeType = hasDiamondShape(shape.el) ? 'diamond' :
                      (shape.height > 150 ? 'record' : 'box');

    nodes.push({
      id: `node_${nodes.length}`,
      label,
      center: {
        x: shape.translate.x + shape.width / 2,
        y: shape.translate.y + shape.height / 2,
      },
      shape: shapeType,
      width: shape.width,
      height: shape.height,
    });
  }

  return nodes;
}

function hasDescendantWithClass(el: Element, tagName: string, className: string): boolean {
  const elements = el.getElementsByTagName(tagName);
  for (let i = 0; i < elements.length; i++) {
    const cls = elements[i].getAttribute('class') || '';
    if (cls.includes(className)) return true;
  }
  return false;
}

function hasStyledRect(el: Element, depth = 0): boolean {
  if (depth > 3) return false;
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.nodeType !== 1) continue;
    const childEl = child as Element;
    if (childEl.tagName === 'rect') {
      const style = childEl.getAttribute('style') || '';
      if (style.includes('fill: #ffffff') || style.includes('fill:#ffffff')) return true;
    }
    if (childEl.tagName === 'g' && hasStyledRect(childEl, depth + 1)) return true;
  }
  return false;
}

function hasDiamondShape(el: Element): boolean {
  const paths = el.getElementsByTagName('path');
  for (let i = 0; i < paths.length; i++) {
    const d = paths[i].getAttribute('d') || '';
    const arcCount = (d.match(/A/g) || []).length;
    if (arcCount >= 4) return true;
  }
  return false;
}

export function extractEdges(doc: Document): ParsedEdge[] {
  const allGroups = Array.from(doc.getElementsByTagName('g'));
  const edges: ParsedEdge[] = [];

  for (const g of allGroups) {
    // Edge groups contain <use xlink:href="#LineHeadArrow2">
    const useEls = g.getElementsByTagName('use');
    let hasArrow = false;
    let arrowTranslate: Point | null = null;

    for (let i = 0; i < useEls.length; i++) {
      const href = useEls[i].getAttribute('xlink:href') || useEls[i].getAttribute('href') || '';
      if (href === '#LineHeadArrow2') {
        hasArrow = true;
        arrowTranslate = parseTranslate(useEls[i].getAttribute('transform'));
        break;
      }
    }

    if (!hasArrow || !arrowTranslate) continue;

    // Must be a direct group with transform (not a nested child)
    const transform = g.getAttribute('transform');
    if (!transform) continue;
    const groupTranslate = parseTranslate(transform);
    if (!groupTranslate) continue;

    // Find the main path (direct child, not clipPath children)
    const children = g.childNodes;
    let pathD: string | null = null;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType === 1 && (child as Element).tagName === 'path') {
        pathD = (child as Element).getAttribute('d');
        break;
      }
    }

    if (!pathD) continue;

    const localStart = getPathStartPoint(pathD);

    edges.push({
      startPoint: {
        x: groupTranslate.x + localStart.x,
        y: groupTranslate.y + localStart.y,
      },
      endPoint: {
        x: groupTranslate.x + arrowTranslate.x,
        y: groupTranslate.y + arrowTranslate.y,
      },
    });
  }

  return edges;
}

function distance(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function matchEdgesToNodes(edges: ParsedEdge[], nodes: ParsedNode[]): void {
  for (const edge of edges) {
    let minStartDist = Infinity;
    let minEndDist = Infinity;

    for (const node of nodes) {
      const startDist = distance(edge.startPoint, node.center);
      const endDist = distance(edge.endPoint, node.center);

      if (startDist < minStartDist) {
        minStartDist = startDist;
        edge.sourceId = node.id;
      }
      if (endDist < minEndDist) {
        minEndDist = endDist;
        edge.targetId = node.id;
      }
    }
  }
}

export function extractOrphanTexts(doc: Document, nodes: ParsedNode[]): OrphanText[] {
  const allGroups = Array.from(doc.getElementsByTagName('g'));
  const orphans: OrphanText[] = [];

  // Collect node translate positions for exclusion
  const nodePositions = new Set(
    nodes.map(n => `${Math.round((n.center.x - n.width / 2) * 10) / 10},${Math.round((n.center.y - n.height / 2) * 10) / 10}`)
  );

  for (const g of allGroups) {
    const transform = g.getAttribute('transform');
    const widthAttr = g.getAttribute('width');
    if (!transform || !widthAttr) continue;

    const translate = parseTranslate(transform);
    if (!translate) continue;

    const width = parseFloat(widthAttr);
    const heightAttr = g.getAttribute('height');
    const height = heightAttr ? parseFloat(heightAttr) : 20;

    // Skip if this position matches a known node
    const posKey = `${Math.round(translate.x * 10) / 10},${Math.round(translate.y * 10) / 10}`;
    if (nodePositions.has(posKey)) continue;

    // Must have text but no shape elements and no arrow markers
    const hasShape = hasDescendantWithClass(g, 'rect', 'shape-element') || hasStyledRect(g) || hasDiamondShape(g);
    const useEls = g.getElementsByTagName('use');
    let hasArrow = false;
    for (let i = 0; i < useEls.length; i++) {
      const href = useEls[i].getAttribute('xlink:href') || useEls[i].getAttribute('href') || '';
      if (href === '#LineHeadArrow2') { hasArrow = true; break; }
    }

    if (hasShape || hasArrow) continue;

    const textEls = g.getElementsByTagName('text');
    if (textEls.length === 0) continue;

    const texts: string[] = [];
    for (let i = 0; i < textEls.length; i++) {
      const t = textEls[i].textContent?.trim();
      if (t) texts.push(t);
    }
    if (texts.length === 0) continue;

    // Skip if this is a nested child of a shape or edge group (check parent)
    const parent = g.parentNode as Element | null;
    if (parent?.getAttribute?.('width') && parseTranslate(parent.getAttribute('transform'))?.x === translate.x) continue;

    orphans.push({
      text: texts.join(' '),
      center: { x: translate.x + width / 2, y: translate.y + height / 2 },
    });
  }

  return orphans;
}

export function assignEdgeLabels(edges: ParsedEdge[], orphanTexts: OrphanText[]): void {
  for (const orphan of orphanTexts) {
    let minDist = Infinity;
    let closestEdge: ParsedEdge | null = null;

    for (const edge of edges) {
      const midpoint: Point = {
        x: (edge.startPoint.x + edge.endPoint.x) / 2,
        y: (edge.startPoint.y + edge.endPoint.y) / 2,
      };
      const dist = distance(orphan.center, midpoint);
      if (dist < minDist) {
        minDist = dist;
        closestEdge = edge;
      }
    }

    // Only assign if reasonably close (within 200px of midpoint)
    if (closestEdge && minDist < 200) {
      closestEdge.label = orphan.text;
    }
  }
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
