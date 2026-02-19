// tests/scripts/svg-to-dot.test.ts
import { describe, it, expect } from 'vitest';
import { extractNodes, parseTranslate, getPathStartPoint, getPathEndPoint } from '../../scripts/svg-to-dot.js';
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
