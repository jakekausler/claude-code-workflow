# SVG-to-DOT Parser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Parse Miro-exported flow.svg into a Graphviz DOT digraph with nodes, edges, labels, and direction.

**Architecture:** Standalone TypeScript script using xmldom for DOM parsing. Walks SVG groups to classify them as nodes (shape+text pairs), edges (path+arrow groups), or edge labels (orphan text near edges). Uses geometric nearest-node matching on edge endpoints to determine connectivity.

**Tech Stack:** TypeScript, xmldom, tsx (script runner), vitest (tests)

---

### Task 1: Install xmldom and create script skeleton

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/package.json` (add xmldom dep)
- Create: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts`

**Step 1: Install xmldom**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npm install xmldom`

**Step 2: Create script skeleton**

```typescript
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
```

**Step 3: Commit**

```bash
git add package.json package-lock.json scripts/svg-to-dot.ts
git commit -m "chore: scaffold SVG-to-DOT parser script with xmldom"
```

---

### Task 2: Implement transform parser and path endpoint parser

**Files:**
- Create: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts` (add functions)
- Create: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/tests/scripts/svg-to-dot.test.ts`

**Step 1: Write failing tests for parseTranslate and parsePathEndpoints**

```typescript
// tests/scripts/svg-to-dot.test.ts
import { describe, it, expect } from 'vitest';
import { parseTranslate, getPathStartPoint, getPathEndPoint } from '../../scripts/svg-to-dot.js';

describe('parseTranslate', () => {
  it('extracts x,y from translate transform', () => {
    expect(parseTranslate('translate(40, 960.74) scale(1) rotate(0, 60, 60)')).toEqual({ x: 40, y: 960.74 });
  });

  it('extracts x,y from simple translate', () => {
    expect(parseTranslate('translate(1160.48, 714.14)')).toEqual({ x: 1160.48, y: 714.14 });
  });

  it('returns null for no translate', () => {
    expect(parseTranslate('scale(1) rotate(0)')).toBeNull();
  });

  it('handles negative coordinates', () => {
    expect(parseTranslate('translate(-10, -20.5)')).toEqual({ x: -10, y: -20.5 });
  });
});

describe('getPathStartPoint', () => {
  it('parses M command at start of path', () => {
    expect(getPathStartPoint('M 0 0 C 29.6 0 55.2 0 74 0')).toEqual({ x: 0, y: 0 });
  });

  it('parses M command with non-zero start', () => {
    expect(getPathStartPoint('M 247.13 133.09 L 8 133.09')).toEqual({ x: 247.13, y: 133.09 });
  });
});

describe('getPathEndPoint', () => {
  it('returns last coordinate pair from L command', () => {
    expect(getPathEndPoint('M 0 0 L 105.94 0')).toEqual({ x: 105.94, y: 0 });
  });

  it('returns last coordinate pair from complex path', () => {
    expect(getPathEndPoint('M 0 142.37 L 44.24 142.37 Q 52.24 142.37 52.24 134.37 L 52.24 8 Q 52.24 0 60.24 0 L 94.3 0')).toEqual({ x: 94.3, y: 0 });
  });

  it('handles vertical path', () => {
    expect(getPathEndPoint('M 0 0 L 0 196.49')).toEqual({ x: 0, y: 196.49 });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: FAIL - functions not exported

**Step 3: Implement and export the parsing functions**

Add to `scripts/svg-to-dot.ts`:

```typescript
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
  // Find the last coordinate pair before the end of the path.
  // Match L, Q endpoint, C endpoint, or bare coordinates at the end.
  // Strategy: find all L/Q/C segments, take the endpoint of the last one.
  const segments = d.match(/[MLCQAZ][^MLCQAZ]*/gi) || [];
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].trim();
    const cmd = seg[0].toUpperCase();
    if (cmd === 'Z') continue;
    const nums = seg.slice(1).trim().match(/-?[\d.]+/g);
    if (!nums || nums.length < 2) continue;
    // For L: last two numbers are x,y
    // For Q: last two numbers are endpoint x,y (nums[2], nums[3])
    // For C: last two numbers are endpoint x,y (nums[4], nums[5])
    // For M: x,y
    return { x: parseFloat(nums[nums.length - 2]), y: parseFloat(nums[nums.length - 1]) };
  }
  throw new Error(`Cannot parse path end: ${d}`);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: add transform and path endpoint parsers with tests"
```

---

### Task 3: Implement node extraction

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts`
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/tests/scripts/svg-to-dot.test.ts`

**Step 1: Write failing test for extractNodes**

Add to test file:

```typescript
import { extractNodes, parseTranslate, getPathStartPoint, getPathEndPoint } from '../../scripts/svg-to-dot.js';
import { DOMParser } from 'xmldom';

describe('extractNodes', () => {
  it('extracts a simple rect node with text', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g>
        <g>
          <g width="120px" height="120px" transform="translate(40, 960.74) scale(1) rotate(0, 60, 60)">
            <svg width="120" height="120" class="shape-background">
              <clipPath id="test1"><rect x="0" y="0" width="120" height="120"/></clipPath>
              <g><rect class="shape-element shape-element-rect" stroke="#1a1a1a" x="0" y="0" width="120" height="120"/></g>
            </svg>
          </g>
          <g width="120px" height="120px" transform="translate(40, 960.74) rotate(0, 60, 60)">
            <g transform="translate(6, 6)">
              <text x="9.5" y="58">Start Looping</text>
            </g>
          </g>
        </g>
      </g>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const nodes = extractNodes(doc);
    expect(nodes.length).toBe(1);
    expect(nodes[0].label).toBe('Start Looping');
    expect(nodes[0].shape).toBe('box');
    expect(nodes[0].center.x).toBeCloseTo(100); // 40 + 120/2
    expect(nodes[0].center.y).toBeCloseTo(1020.74); // 960.74 + 120/2
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: FAIL

**Step 3: Implement extractNodes**

The algorithm:
1. Walk all `<g>` elements with a `transform` containing `translate` and a `width` attribute
2. Classify each as "shape group" if it contains `<rect class="shape-element">`, a diamond `<path>`, or a container `<rect>` with fill
3. Classify each as "text group" if it contains `<text>` but no shapes
4. Pair shape groups with text groups that share the same translate(x,y)
5. Build ParsedNode from each pair

```typescript
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
    const hasDiamondPath = hasDiamondShape(g);

    if (hasShapeRect || hasContainerRect || hasDiamondPath) {
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

    if (!label) continue; // Skip shapeless unlabeled groups

    const shapeType = hasDiamondShape(shape.el) ? 'diamond' :
                      (shape.height > 100 ? 'record' : 'box');

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
    if (child.nodeType !== 1) continue; // Element nodes only
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
  // Diamond nodes have a path with characteristic diamond geometry
  // Look for paths with M...L...A...L...A...L...A...L...A...Z pattern
  const paths = el.getElementsByTagName('path');
  for (let i = 0; i < paths.length; i++) {
    const d = paths[i].getAttribute('d') || '';
    // Diamond paths have multiple Arc commands forming the diamond shape
    const arcCount = (d.match(/A/g) || []).length;
    if (arcCount >= 4) return true;
  }
  return false;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: implement node extraction from SVG groups"
```

---

### Task 4: Implement edge extraction

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts`
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/tests/scripts/svg-to-dot.test.ts`

**Step 1: Write failing test for extractEdges**

```typescript
describe('extractEdges', () => {
  it('extracts an edge with arrow marker', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        <path id="LineHeadArrow2" d="M-12.7,-7.5 L0,0 L-12.7,7.5 Z"/>
      </defs>
      <g>
        <g>
          <g width="104px" height="0px" transform="translate(160, 1020.74) scale(1) rotate(0, 52, 0)">
            <path stroke="#333333" stroke-width="2" fill="transparent"
              d="M 0 0 C 29.6 0 55.2 0 74 0 C 81.9 0 85.9 0 93.8 0"/>
            <use xlink:href="#LineHeadArrow2" fill="#333333" transform="translate(104, 0) rotate(0)"/>
          </g>
        </g>
      </g>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const edges = extractEdges(doc);
    expect(edges.length).toBe(1);
    // Global start = translate(160, 1020.74) + path start M 0 0
    expect(edges[0].startPoint.x).toBeCloseTo(160);
    expect(edges[0].startPoint.y).toBeCloseTo(1020.74);
    // Global end = translate(160, 1020.74) + use translate(104, 0)
    expect(edges[0].endPoint.x).toBeCloseTo(264);
    expect(edges[0].endPoint.y).toBeCloseTo(1020.74);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: FAIL

**Step 3: Implement extractEdges**

```typescript
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

    // Find the main path (not clipPath children)
    const paths = g.childNodes;
    let pathD: string | null = null;
    for (let i = 0; i < paths.length; i++) {
      const child = paths[i];
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: implement edge extraction from SVG arrow markers"
```

---

### Task 5: Implement edge-to-node matching and orphan text extraction

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts`
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/tests/scripts/svg-to-dot.test.ts`

**Step 1: Write failing tests**

```typescript
describe('matchEdgesToNodes', () => {
  it('matches edge endpoints to nearest nodes', () => {
    const nodes: ParsedNode[] = [
      { id: 'n0', label: 'A', center: { x: 100, y: 100 }, shape: 'box', width: 120, height: 120 },
      { id: 'n1', label: 'B', center: { x: 400, y: 100 }, shape: 'box', width: 120, height: 120 },
    ];
    const edges: ParsedEdge[] = [
      { startPoint: { x: 160, y: 100 }, endPoint: { x: 340, y: 100 } },
    ];
    matchEdgesToNodes(edges, nodes);
    expect(edges[0].sourceId).toBe('n0');
    expect(edges[0].targetId).toBe('n1');
  });
});

describe('extractOrphanTexts', () => {
  it('returns text groups not associated with any node', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <g><g>
        <g width="120px" height="120px" transform="translate(40, 40) scale(1) rotate(0, 60, 60)">
          <svg width="120" height="120" class="shape-background">
            <g><rect class="shape-element shape-element-rect" x="0" y="0" width="120" height="120"/></g>
          </svg>
        </g>
        <g width="120px" height="120px" transform="translate(40, 40) rotate(0, 60, 60)">
          <g><text x="10" y="50">Node A</text></g>
        </g>
        <g width="50px" height="20px" transform="translate(200, 90) scale(1) rotate(0)">
          <text x="0" y="14">Yes</text>
        </g>
      </g></g>
    </svg>`;
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const nodes = extractNodes(doc);
    const orphans = extractOrphanTexts(doc, nodes);
    expect(orphans.length).toBe(1);
    expect(orphans[0].text).toBe('Yes');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: FAIL

**Step 3: Implement matching functions**

```typescript
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
    // Find the edge whose midpoint is closest to this text
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
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: implement edge-to-node matching and orphan text extraction"
```

---

### Task 6: Implement DOT output formatter

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts`
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/tests/scripts/svg-to-dot.test.ts`

**Step 1: Write failing test**

```typescript
describe('formatDot', () => {
  it('produces valid DOT output', () => {
    const nodes: ParsedNode[] = [
      { id: 'node_0', label: 'Start', center: { x: 100, y: 100 }, shape: 'box', width: 120, height: 120 },
      { id: 'node_1', label: 'Decision?', center: { x: 300, y: 100 }, shape: 'diamond', width: 200, height: 120 },
      { id: 'node_2', label: 'End', center: { x: 500, y: 100 }, shape: 'box', width: 120, height: 40 },
    ];
    const edges: ParsedEdge[] = [
      { startPoint: { x: 160, y: 100 }, endPoint: { x: 200, y: 100 }, sourceId: 'node_0', targetId: 'node_1' },
      { startPoint: { x: 400, y: 100 }, endPoint: { x: 440, y: 100 }, sourceId: 'node_1', targetId: 'node_2', label: 'Yes' },
    ];
    const dot = formatDot(nodes, edges);
    expect(dot).toContain('digraph');
    expect(dot).toContain('node_0 [label="Start"');
    expect(dot).toContain('node_1 [label="Decision?"');
    expect(dot).toContain('shape=diamond');
    expect(dot).toContain('node_0 -> node_1');
    expect(dot).toContain('node_1 -> node_2 [label="Yes"]');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: FAIL

**Step 3: Implement formatDot**

```typescript
export function formatDot(nodes: ParsedNode[], edges: ParsedEdge[]): string {
  const lines: string[] = ['digraph MiroFlow {', '    rankdir=TB;', ''];

  // Nodes
  for (const node of nodes) {
    const escapedLabel = node.label.replace(/"/g, '\\"');
    const shapeAttr = node.shape === 'diamond' ? 'diamond' :
                      node.shape === 'record' ? 'record' : 'box';
    lines.push(`    ${node.id} [label="${escapedLabel}" shape=${shapeAttr}];`);
  }

  lines.push('');

  // Edges
  for (const edge of edges) {
    if (!edge.sourceId || !edge.targetId) continue;
    if (edge.sourceId === edge.targetId) continue; // skip self-loops from mismatches
    const labelAttr = edge.label ? ` [label="${edge.label.replace(/"/g, '\\"')}"]` : '';
    lines.push(`    ${edge.sourceId} -> ${edge.targetId}${labelAttr};`);
  }

  lines.push('}');
  return lines.join('\n');
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/svg-to-dot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: implement DOT output formatter"
```

---

### Task 7: Integration test with actual SVG

**Files:**
- Modify: `/home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli/scripts/svg-to-dot.ts` (wire up main)

**Step 1: Wire up main function with all implementations**

Ensure the `main()` function calls all the implemented functions (extractNodes, extractEdges, extractOrphanTexts, matchEdgesToNodes, assignEdgeLabels, formatDot) in the correct order. This should already be in the skeleton from Task 1.

**Step 2: Run against actual SVG**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npx tsx scripts/svg-to-dot.ts ../../docs/plans/flow.svg`

Expected: DOT output to stdout with nodes and edges. Inspect the output:
- Verify all meaningful nodes are present (Start Looping, Grab a Stage, decision diamonds, etc.)
- Verify edges connect sensible source->target pairs
- Verify edge labels (Yes, No, N Workers) are assigned to correct edges

**Step 3: Debug and fix any mismatches**

Common issues to check:
- Nodes with multi-line text may have duplicate labels
- Edge labels might be matched to wrong edges if orphan text is far from midpoint
- Self-loops from edges where start/end match same node
- Duplicate edges from nested group matching

Iterate until output looks correct.

**Step 4: Run all tests**

Run: `cd /home/jakekausler/dev/localenv/claude-code-workflow/tools/kanban-cli && npm run verify`
Expected: All tests pass, no lint errors

**Step 5: Commit final working version**

```bash
git add scripts/svg-to-dot.ts tests/scripts/svg-to-dot.test.ts
git commit -m "feat: complete SVG-to-DOT parser with integration testing"
```
