// tests/scripts/svg-to-dot.test.ts
import { describe, it, expect } from 'vitest';
import { extractNodes, extractEdges, parseTranslate, getPathStartPoint, getPathEndPoint, matchEdgesToNodes, extractOrphanTexts, assignEdgeLabels } from '../../scripts/svg-to-dot.js';
import type { ParsedNode, ParsedEdge, OrphanText } from '../../scripts/svg-to-dot.js';
import { DOMParser } from 'xmldom';

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
