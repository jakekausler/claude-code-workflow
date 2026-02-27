---
title: "Long-session rendering performance"
phase: 14
labels: [enhancement, ui, performance]
depends_on: []
---

# Long-Session Rendering Performance

Optimize the session viewer for long sessions with many DOM elements.

## Problem

Long Claude sessions produce large numbers of chunks, tool calls, and messages. The session viewer renders all of these as DOM elements, causing lag and jank as sessions grow. Some existing optimizations are in place but insufficient for very long sessions.

## Investigation Areas

- Profile the session viewer with a large JSONL file to identify specific bottlenecks
- Count DOM elements at various session sizes to establish thresholds
- Measure render times for chunk components, tool renderers, and context panels

## Likely Solutions

### Virtualized Rendering
- Only render chunks visible in the viewport (plus a small buffer)
- Libraries: `react-virtuoso`, `@tanstack/react-virtual`, or `react-window`
- Requires known or estimated heights for chunks (variable-height virtualization)

### Progressive Loading
- Load and render chunks in batches as the user scrolls
- Show loading indicators for chunks not yet rendered

### Render Optimization
- Memoize expensive tool renderers
- Lazy-render collapsed tool call details
- Reduce re-renders on SSE updates (only update changed chunks)

## Success Criteria

- Session viewer remains responsive (< 100ms interaction latency) for sessions with 500+ chunks
- Scrolling is smooth (60fps) regardless of session length
- Initial load time for large sessions under 2 seconds
