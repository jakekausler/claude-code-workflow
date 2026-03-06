# Stage 9F: Session Detail Display — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build ~20 React components that render parsed JSONL session data as a full claude-devtools-quality session viewer with chat history, tool renderers, subagent trees, context tracking, and cost display.

**Architecture:** Client-side only — all data comes from existing 9E API endpoints. Components live in `src/client/components/chat/`, `src/client/components/chat/items/`, `src/client/components/tools/`, and `src/client/components/chat/context/`. Session detail is accessible both as a tab in the stage drawer and via direct URL at `/sessions/:projectId/:sessionId`. Virtual scrolling via `@tanstack/react-virtual` handles large sessions (1000+ chunks).

**Tech Stack:** React 19, TypeScript 5 (strict, NodeNext), Zustand 5, React Query 5, @tanstack/react-virtual 3, react-markdown 10, remark-gfm 4, shiki 3, lucide-react, Tailwind CSS 3.4, Vitest 3

---

## Pre-Implementation Notes

### ESM Import Rules
- All local imports MUST use `.js` extensions: `import { foo } from './bar.js'`
- npm package imports do NOT need extensions
- Type-only imports from server types use: `import type { ParsedSession } from '@server/types/jsonl.js'`

### Existing Patterns to Follow
- **Zustand stores**: Immutable updates with `set((state) => ({ ... }))`, located in `src/client/store/`
- **React Query hooks**: Located in `src/client/api/hooks.ts`, use `apiFetch<T>()` from `src/client/api/client.ts`
- **Components**: Tailwind utility classes, lucide-react icons, consistent loading/error states
- **Drawer system**: Stack-based via `drawer-store.ts`, content routed by type in `DrawerHost.tsx`

### Dependencies
All needed npm packages are already installed:
- `@tanstack/react-virtual@^3.10.0`
- `react-markdown@^10.0.0`
- `remark-gfm@^4.0.0`
- `shiki@^3.0.0`
- `lucide-react@^0.460.0`

### Testing Strategy
No client-side component tests exist in this project. The vitest config only matches `tests/**/*.test.ts`. Server-side integration tests exist for the session API endpoints (248 tests). For 9F, we will:
1. Write **unit tests** for pure logic (formatters, summary generators, token formatters) in `tests/client/*.test.ts`
2. Write **integration tests** that verify the session API returns data compatible with our component props in `tests/server/session-rendering.test.ts`
3. Skip React component rendering tests (no @testing-library/react, no jsdom configured) — visual verification via dev server

### File Path Conventions
All paths below are relative to `/storage/programs/claude-code-workflow/tools/web-server/`.

---

## Task 1: Client-Accessible Session Types & Shared Utilities

**Goal:** Create client-side type re-exports and shared formatting utilities for session data.

**Files:**
- Create: `src/client/types/session.ts`
- Create: `src/client/utils/session-formatters.ts`
- Test: `tests/client/session-formatters.test.ts`

### Step 1: Create `src/client/types/session.ts`

Re-export the server types needed by client components. Since Vite's `@server/*` alias makes server types importable at build time, use type-only re-exports:

```typescript
// Re-export session types for client components
// These are type-only imports — erased at build time, no runtime server dependency
export type {
  ParsedSession,
  SessionMetrics,
  Chunk,
  UserChunk,
  AIChunk,
  SystemChunk,
  CompactChunk,
  EnhancedAIChunk,
  SemanticStep,
  SemanticStepType,
  ToolExecution,
  Process,
  ParsedMessage,
  ToolCall,
  ToolResult,
  ContentBlock,
  TextContent,
  ThinkingContent,
  ToolUseContent,
  ToolResultContent,
  ImageContent,
  UsageMetadata,
} from '@server/types/jsonl.js';
```

### Step 2: Write failing tests for session formatters

Create `tests/client/session-formatters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  formatTokenCount,
  formatDuration,
  formatCost,
  generateToolSummary,
  formatTimestamp,
} from '../../src/client/utils/session-formatters.js';

describe('session-formatters', () => {
  describe('formatTokenCount', () => {
    it('formats small numbers directly', () => {
      expect(formatTokenCount(500)).toBe('500');
    });

    it('formats thousands with K suffix', () => {
      expect(formatTokenCount(12300)).toBe('12.3K');
    });

    it('formats millions with M suffix', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M');
    });

    it('returns 0 for zero', () => {
      expect(formatTokenCount(0)).toBe('0');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(125000)).toBe('2m 5s');
    });

    it('formats hours', () => {
      expect(formatDuration(3661000)).toBe('1h 1m');
    });

    it('returns 0s for zero', () => {
      expect(formatDuration(0)).toBe('0s');
    });
  });

  describe('formatCost', () => {
    it('formats cost with dollar sign and 2 decimal places', () => {
      expect(formatCost(1.5)).toBe('$1.50');
    });

    it('formats small costs with 4 decimal places', () => {
      expect(formatCost(0.0023)).toBe('$0.0023');
    });

    it('formats zero', () => {
      expect(formatCost(0)).toBe('$0.00');
    });
  });

  describe('generateToolSummary', () => {
    it('generates Edit summary', () => {
      const input = { file_path: '/src/app.ts', old_string: 'abc', new_string: 'abcdef' };
      expect(generateToolSummary('Edit', input)).toBe('app.ts');
    });

    it('generates Read summary with line range', () => {
      const input = { file_path: '/src/utils.ts', offset: 1, limit: 100 };
      expect(generateToolSummary('Read', input)).toBe('utils.ts — lines 1-100');
    });

    it('generates Read summary without line range', () => {
      const input = { file_path: '/src/utils.ts' };
      expect(generateToolSummary('Read', input)).toBe('utils.ts');
    });

    it('generates Bash summary with truncated command', () => {
      const input = { command: 'npm run build && npm run test -- --coverage --reporter=verbose' };
      expect(generateToolSummary('Bash', input)).toBe('npm run build && npm run test -- --co…');
    });

    it('generates Bash summary for short commands', () => {
      const input = { command: 'git status' };
      expect(generateToolSummary('Bash', input)).toBe('git status');
    });

    it('generates Grep summary', () => {
      const input = { pattern: 'TODO', glob: '*.ts' };
      expect(generateToolSummary('Grep', input)).toBe('"TODO" in *.ts');
    });

    it('generates Glob summary', () => {
      const input = { pattern: 'src/**/*.tsx' };
      expect(generateToolSummary('Glob', input)).toBe('src/**/*.tsx');
    });

    it('generates Write summary', () => {
      const input = { file_path: '/src/new-file.ts', content: 'abc' };
      expect(generateToolSummary('Write', input)).toBe('new-file.ts');
    });

    it('generates Task summary', () => {
      const input = { description: 'Explore the authentication system', subagent_type: 'Explore' };
      expect(generateToolSummary('Task', input)).toBe('Explore — Explore the authentication…');
    });

    it('generates Skill summary', () => {
      const input = { skill: 'commit' };
      expect(generateToolSummary('Skill', input)).toBe('commit');
    });

    it('falls back to tool name for unknown tools', () => {
      const input = { foo: 'bar' };
      expect(generateToolSummary('mcp__custom_tool', input)).toBe('mcp__custom_tool');
    });
  });

  describe('formatTimestamp', () => {
    it('formats a date as time string', () => {
      const date = new Date('2026-02-26T14:30:00Z');
      const result = formatTimestamp(date);
      // Should contain hours and minutes
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
```

### Step 3: Run tests to verify they fail

Run: `cd tools/web-server && npx vitest run tests/client/session-formatters.test.ts`

Note: The vitest `include` pattern is `tests/**/*.test.ts` which already matches this path.

Expected: FAIL — module not found

### Step 4: Implement `src/client/utils/session-formatters.ts`

```typescript
import { basename } from 'path';

/**
 * Format token count with K/M suffix.
 * 500 → "500", 12300 → "12.3K", 1500000 → "1.5M"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number(m.toFixed(1))}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${Number(k.toFixed(1))}K`;
  }
  return String(tokens);
}

/**
 * Format duration in ms to human-readable.
 * 5000 → "5s", 125000 → "2m 5s", 3661000 → "1h 1m"
 */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Format cost with dollar sign. Small values get 4 decimal places.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/**
 * Extract filename from a path.
 */
function extractFilename(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * Truncate string with ellipsis at maxLen.
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/**
 * Generate a concise tool summary for collapsed LinkedToolItem display.
 */
export function generateToolSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  switch (toolName) {
    case 'Edit': {
      const fp = input.file_path as string | undefined;
      return fp ? extractFilename(fp) : 'Edit';
    }
    case 'Read': {
      const fp = input.file_path as string | undefined;
      if (!fp) return 'Read';
      const name = extractFilename(fp);
      const offset = input.offset as number | undefined;
      const limit = input.limit as number | undefined;
      if (offset != null && limit != null) {
        return `${name} — lines ${offset}-${limit}`;
      }
      return name;
    }
    case 'Write': {
      const fp = input.file_path as string | undefined;
      return fp ? extractFilename(fp) : 'Write';
    }
    case 'Bash': {
      const cmd = input.command as string | undefined;
      const desc = input.description as string | undefined;
      return truncate(desc || cmd || 'Bash', 40);
    }
    case 'Grep': {
      const pattern = input.pattern as string | undefined;
      const glob = input.glob as string | undefined;
      if (pattern && glob) return `"${pattern}" in ${glob}`;
      if (pattern) return `"${pattern}"`;
      return 'Grep';
    }
    case 'Glob': {
      const pattern = input.pattern as string | undefined;
      return pattern || 'Glob';
    }
    case 'Task': {
      const desc = input.description as string | undefined;
      const type = input.subagent_type as string | undefined;
      if (type && desc) return `${type} — ${truncate(desc, 30)}`;
      if (desc) return truncate(desc, 40);
      return 'Task';
    }
    case 'Skill': {
      const skill = input.skill as string | undefined;
      return skill || 'Skill';
    }
    default:
      return toolName;
  }
}

/**
 * Format a Date as a local time string (HH:MM).
 */
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```

### Step 5: Run tests to verify they pass

Run: `cd tools/web-server && npx vitest run tests/client/session-formatters.test.ts`

Expected: All 16 tests PASS

### Step 6: Create React Query hooks for session data

Add to `src/client/api/hooks.ts`:

```typescript
// Add these imports at the top (alongside existing ones):
import type { ParsedSession, SessionMetrics, Process } from '@server/types/jsonl.js';

// Add these hooks at the bottom of the file:

export function useSessionDetail(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId],
    queryFn: () => apiFetch<ParsedSession>(`/api/sessions/${encodeURIComponent(projectId)}/${sessionId}`),
    enabled: !!projectId && !!sessionId,
  });
}

export function useSessionMetrics(projectId: string, sessionId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId, 'metrics'],
    queryFn: () => apiFetch<SessionMetrics>(`/api/sessions/${encodeURIComponent(projectId)}/${sessionId}/metrics`),
    enabled: !!projectId && !!sessionId,
  });
}

export function useSubagent(projectId: string, sessionId: string, agentId: string) {
  return useQuery({
    queryKey: ['session', projectId, sessionId, 'subagent', agentId],
    queryFn: () => apiFetch<Process>(`/api/sessions/${encodeURIComponent(projectId)}/${sessionId}/subagents/${agentId}`),
    enabled: !!projectId && !!sessionId && !!agentId,
  });
}

export function useStageSession(stageId: string) {
  return useQuery({
    queryKey: ['stage', stageId, 'session'],
    queryFn: () => apiFetch<{ sessionId: string; stageId: string }>(`/api/stages/${stageId}/session`),
    enabled: !!stageId,
  });
}
```

### Step 7: Update session-store with expansion state

Replace `src/client/store/session-store.ts` with expanded state for the session viewer:

```typescript
import { create } from 'zustand';

interface SessionViewState {
  /** Which chunk indices are explicitly expanded */
  expandedChunks: Set<number>;
  /** Which tool call IDs are expanded */
  expandedTools: Set<string>;
  /** Which subagent IDs are expanded to level 1 */
  expandedSubagents: Set<string>;
  /** Which subagent IDs are expanded to level 2 (execution trace) */
  expandedSubagentTraces: Set<string>;
  /** Whether user is near bottom of scroll (for auto-scroll) */
  isNearBottom: boolean;

  toggleChunk: (index: number) => void;
  toggleTool: (toolCallId: string) => void;
  toggleSubagent: (agentId: string) => void;
  toggleSubagentTrace: (agentId: string) => void;
  setIsNearBottom: (near: boolean) => void;
  resetView: () => void;
}

export const useSessionViewStore = create<SessionViewState>((set) => ({
  expandedChunks: new Set(),
  expandedTools: new Set(),
  expandedSubagents: new Set(),
  expandedSubagentTraces: new Set(),
  isNearBottom: true,

  toggleChunk: (index) =>
    set((state) => {
      const next = new Set(state.expandedChunks);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { expandedChunks: next };
    }),

  toggleTool: (toolCallId) =>
    set((state) => {
      const next = new Set(state.expandedTools);
      if (next.has(toolCallId)) next.delete(toolCallId);
      else next.add(toolCallId);
      return { expandedTools: next };
    }),

  toggleSubagent: (agentId) =>
    set((state) => {
      const next = new Set(state.expandedSubagents);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { expandedSubagents: next };
    }),

  toggleSubagentTrace: (agentId) =>
    set((state) => {
      const next = new Set(state.expandedSubagentTraces);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { expandedSubagentTraces: next };
    }),

  setIsNearBottom: (near) => set({ isNearBottom: near }),

  resetView: () =>
    set({
      expandedChunks: new Set(),
      expandedTools: new Set(),
      expandedSubagents: new Set(),
      expandedSubagentTraces: new Set(),
      isNearBottom: true,
    }),
}));
```

Note: The existing `session-store.ts` currently only tracks active session IDs. Read it first to understand what's there — the new store should be a separate export or a replacement, preserving any existing functionality.

### Step 8: Commit

```bash
git add src/client/types/session.ts src/client/utils/session-formatters.ts src/client/api/hooks.ts src/client/store/session-store.ts tests/client/session-formatters.test.ts
git commit -m "feat(web-server): add session types, formatters, hooks, and view store for 9F"
```

---

## Task 2: Simple Chunk Components — UserChunk, SystemChunk, CompactChunk

**Goal:** Build the three simplest chunk renderers (no tool rendering, no semantic steps).

**Files:**
- Create: `src/client/components/chat/UserChunk.tsx`
- Create: `src/client/components/chat/SystemChunk.tsx`
- Create: `src/client/components/chat/CompactChunk.tsx`

### Step 1: Create `src/client/components/chat/UserChunk.tsx`

```tsx
import { User } from 'lucide-react';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { UserChunk as UserChunkType } from '../../types/session.js';

interface Props {
  chunk: UserChunkType;
}

export function UserChunk({ chunk }: Props) {
  const { message, timestamp } = chunk;
  const text =
    typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n');

  return (
    <div className="flex justify-end mb-4">
      <div className="max-w-[80%] flex gap-2">
        <div className="bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-sm">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
          <div className="text-xs text-blue-200 mt-1 text-right">
            {formatTimestamp(timestamp)}
          </div>
        </div>
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
          <User className="w-4 h-4 text-blue-600" />
        </div>
      </div>
    </div>
  );
}
```

### Step 2: Create `src/client/components/chat/SystemChunk.tsx`

```tsx
import { Terminal } from 'lucide-react';
import { formatTimestamp } from '../../utils/session-formatters.js';
import type { SystemChunk as SystemChunkType } from '../../types/session.js';

interface Props {
  chunk: SystemChunkType;
}

export function SystemChunk({ chunk }: Props) {
  const { messages, timestamp } = chunk;

  // System chunks may contain turn_duration or init entries
  const texts = messages
    .map((m) => {
      if (typeof m.content === 'string') return m.content;
      return m.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    })
    .filter(Boolean);

  if (texts.length === 0) return null;

  return (
    <div className="flex justify-center mb-4">
      <div className="max-w-[70%] bg-slate-100 border border-slate-200 rounded-lg px-4 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
          <Terminal className="w-3 h-3" />
          <span>System</span>
          <span className="ml-auto">{formatTimestamp(timestamp)}</span>
        </div>
        {texts.map((text, i) => (
          <pre
            key={i}
            className="text-xs text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto"
          >
            {text}
          </pre>
        ))}
      </div>
    </div>
  );
}
```

### Step 3: Create `src/client/components/chat/CompactChunk.tsx`

```tsx
import { Minimize2 } from 'lucide-react';
import { formatTokenCount } from '../../utils/session-formatters.js';
import type { CompactChunk as CompactChunkType } from '../../types/session.js';

interface Props {
  chunk: CompactChunkType;
}

export function CompactChunk({ chunk }: Props) {
  return (
    <div className="flex items-center gap-3 my-6 px-4">
      <div className="flex-1 h-px bg-amber-300" />
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
        <Minimize2 className="w-3 h-3" />
        <span className="font-medium">Context compacted</span>
      </div>
      <div className="flex-1 h-px bg-amber-300" />
    </div>
  );
}
```

### Step 4: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

Expected: No errors related to the new files

### Step 5: Commit

```bash
git add src/client/components/chat/UserChunk.tsx src/client/components/chat/SystemChunk.tsx src/client/components/chat/CompactChunk.tsx
git commit -m "feat(web-server): add UserChunk, SystemChunk, CompactChunk components"
```

---

## Task 3: TextItem & ThinkingItem

**Goal:** Build markdown rendering and collapsible thinking blocks used inside AIChunk.

**Files:**
- Create: `src/client/components/chat/items/TextItem.tsx`
- Create: `src/client/components/chat/items/ThinkingItem.tsx`

### Step 1: Create `src/client/components/chat/items/TextItem.tsx`

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

export function TextItem({ content }: Props) {
  return (
    <div className="prose prose-sm prose-slate max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }
            // Block code — use pre with monospace styling
            // Shiki integration can be added later for syntax highlighting
            const lang = className?.replace('language-', '') || '';
            return (
              <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 overflow-x-auto text-xs">
                <code className={className} data-language={lang} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          pre({ children }) {
            // Unwrap the extra <pre> that ReactMarkdown adds around code blocks
            return <>{children}</>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto">
                <table className="min-w-full">{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

### Step 2: Create `src/client/components/chat/items/ThinkingItem.tsx`

```tsx
import { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { formatTokenCount } from '../../../utils/session-formatters.js';

interface Props {
  content: string;
  tokenCount?: number;
}

export function ThinkingItem({ content, tokenCount }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-purple-200 bg-purple-50/50 rounded-lg overflow-hidden my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-purple-700 hover:bg-purple-100/50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <Brain className="w-4 h-4" />
        <span className="font-medium">Thinking</span>
        {tokenCount != null && (
          <span className="ml-auto text-xs text-purple-500 bg-purple-100 rounded-full px-2 py-0.5">
            {formatTokenCount(tokenCount)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-purple-200 bg-white/50">
          <pre className="text-xs text-purple-900 font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
```

### Step 3: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 4: Commit

```bash
git add src/client/components/chat/items/TextItem.tsx src/client/components/chat/items/ThinkingItem.tsx
git commit -m "feat(web-server): add TextItem (markdown) and ThinkingItem (collapsible) components"
```

---

## Task 4: DefaultRenderer — Fallback Tool Renderer

**Goal:** Build the fallback renderer for any tool without a specialized renderer. Shows key-value input params and raw output.

**Files:**
- Create: `src/client/components/tools/DefaultRenderer.tsx`

### Step 1: Create `src/client/components/tools/DefaultRenderer.tsx`

```tsx
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function DefaultRenderer({ execution }: Props) {
  const { input, result } = execution;

  const resultContent = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  return (
    <div className="space-y-3 text-sm">
      {/* Input params */}
      <div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
          Input
        </div>
        <div className="bg-slate-50 rounded-lg p-3 space-y-1">
          {Object.entries(input).map(([key, value]) => (
            <div key={key} className="flex gap-2">
              <span className="text-slate-500 font-mono text-xs flex-shrink-0">{key}:</span>
              <span className="text-slate-800 text-xs font-mono break-all">
                {typeof value === 'string'
                  ? value.length > 200
                    ? value.slice(0, 200) + '…'
                    : value
                  : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Output */}
      {resultContent && (
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
            {result?.isError ? 'Error' : 'Output'}
          </div>
          <pre
            className={`rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto ${
              result?.isError
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-slate-50 text-slate-800'
            }`}
          >
            {resultContent}
          </pre>
        </div>
      )}
    </div>
  );
}
```

### Step 2: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 3: Commit

```bash
git add src/client/components/tools/DefaultRenderer.tsx
git commit -m "feat(web-server): add DefaultRenderer fallback tool renderer"
```

---

## Task 5: Specialized Tool Renderers — Read, Edit, Write, Bash

**Goal:** Build the 4 most common tool renderers.

**Files:**
- Create: `src/client/components/tools/ReadRenderer.tsx`
- Create: `src/client/components/tools/EditRenderer.tsx`
- Create: `src/client/components/tools/WriteRenderer.tsx`
- Create: `src/client/components/tools/BashRenderer.tsx`

### Step 1: Create `src/client/components/tools/ReadRenderer.tsx`

```tsx
import { FileText } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function ReadRenderer({ execution }: Props) {
  const { input, result } = execution;
  const filePath = input.file_path as string | undefined;
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  const content = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <FileText className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
          {offset != null && limit != null && (
            <span className="text-xs text-slate-400">
              lines {offset}-{offset + limit}
            </span>
          )}
        </div>
      )}
      {content && (
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {content}
        </pre>
      )}
    </div>
  );
}
```

### Step 2: Create `src/client/components/tools/EditRenderer.tsx`

```tsx
import { Pencil } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function EditRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <Pencil className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
        </div>
      )}
      <div className="rounded-lg overflow-hidden border border-slate-200">
        {oldString && (
          <div className="bg-red-50 border-b border-slate-200">
            <div className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 border-b border-red-200">
              Removed
            </div>
            <pre className="px-3 py-2 text-xs font-mono text-red-800 whitespace-pre-wrap overflow-x-auto">
              {oldString}
            </pre>
          </div>
        )}
        {newString && (
          <div className="bg-green-50">
            <div className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 border-b border-green-200">
              Added
            </div>
            <pre className="px-3 py-2 text-xs font-mono text-green-800 whitespace-pre-wrap overflow-x-auto">
              {newString}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 3: Create `src/client/components/tools/WriteRenderer.tsx`

```tsx
import { FilePlus } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function WriteRenderer({ execution }: Props) {
  const { input } = execution;
  const filePath = input.file_path as string | undefined;
  const content = input.content as string | undefined;

  return (
    <div className="space-y-2 text-sm">
      {filePath && (
        <div className="flex items-center gap-2 text-slate-600">
          <FilePlus className="w-4 h-4" />
          <span className="font-mono text-xs">{filePath}</span>
        </div>
      )}
      {content && (
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
          {content}
        </pre>
      )}
    </div>
  );
}
```

### Step 4: Create `src/client/components/tools/BashRenderer.tsx`

```tsx
import { TerminalSquare } from 'lucide-react';
import { formatDuration } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function BashRenderer({ execution }: Props) {
  const { input, result, durationMs } = execution;
  const command = input.command as string | undefined;
  const description = input.description as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  // Heuristic: lines starting with common error patterns are stderr
  const isStderrLine = (line: string) =>
    line.startsWith('Error:') ||
    line.startsWith('error:') ||
    line.startsWith('ERR!') ||
    line.startsWith('WARN') ||
    line.startsWith('fatal:');

  return (
    <div className="space-y-2 text-sm">
      {description && (
        <div className="text-xs text-slate-500 italic">{description}</div>
      )}
      {command && (
        <div className="flex items-center gap-2">
          <TerminalSquare className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <code className="text-xs font-mono text-slate-800 bg-slate-100 px-2 py-1 rounded break-all">
            {command}
          </code>
        </div>
      )}
      {output && (
        <pre className="bg-slate-900 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
          {output.split('\n').map((line, i) => (
            <div
              key={i}
              className={isStderrLine(line) ? 'text-red-400' : 'text-green-400'}
            >
              {line}
            </div>
          ))}
        </pre>
      )}
      {durationMs != null && (
        <div className="text-xs text-slate-400">
          Duration: {formatDuration(durationMs)}
        </div>
      )}
      {result?.isError && (
        <div className="text-xs text-red-600 font-medium">
          Exit: non-zero
        </div>
      )}
    </div>
  );
}
```

### Step 5: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 6: Commit

```bash
git add src/client/components/tools/ReadRenderer.tsx src/client/components/tools/EditRenderer.tsx src/client/components/tools/WriteRenderer.tsx src/client/components/tools/BashRenderer.tsx
git commit -m "feat(web-server): add Read, Edit, Write, Bash tool renderers"
```

---

## Task 6: Specialized Tool Renderers — Glob, Grep, Skill

**Goal:** Build the remaining specialized tool renderers.

**Files:**
- Create: `src/client/components/tools/GlobRenderer.tsx`
- Create: `src/client/components/tools/GrepRenderer.tsx`
- Create: `src/client/components/tools/SkillRenderer.tsx`

### Step 1: Create `src/client/components/tools/GlobRenderer.tsx`

```tsx
import { FolderSearch } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function GlobRenderer({ execution }: Props) {
  const { input, result } = execution;
  const pattern = input.pattern as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  const files = output ? output.split('\n').filter(Boolean) : [];

  return (
    <div className="space-y-2 text-sm">
      {pattern && (
        <div className="flex items-center gap-2 text-slate-600">
          <FolderSearch className="w-4 h-4" />
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">{pattern}</code>
          <span className="text-xs text-slate-400">{files.length} files</span>
        </div>
      )}
      {files.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">
          {files.map((file, i) => (
            <div key={i} className="text-xs font-mono text-slate-700 py-0.5">
              {file}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 2: Create `src/client/components/tools/GrepRenderer.tsx`

```tsx
import { Search } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function GrepRenderer({ execution }: Props) {
  const { input, result } = execution;
  const pattern = input.pattern as string | undefined;
  const glob = input.glob as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  const lines = output ? output.split('\n').filter(Boolean) : [];

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Search className="w-4 h-4" />
        {pattern && (
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">
            "{pattern}"
          </code>
        )}
        {glob && (
          <span className="text-xs text-slate-400">in {glob}</span>
        )}
        <span className="text-xs text-slate-400">{lines.length} matches</span>
      </div>
      {lines.length > 0 && (
        <pre className="bg-slate-50 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
          {lines.map((line, i) => (
            <div key={i} className="text-slate-700 py-0.5">
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
```

### Step 3: Create `src/client/components/tools/SkillRenderer.tsx`

```tsx
import { Zap } from 'lucide-react';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function SkillRenderer({ execution }: Props) {
  const { input, result } = execution;
  const skillName = input.skill as string | undefined;
  const args = input.args as string | undefined;

  const output = result
    ? typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2)
    : null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Zap className="w-4 h-4 text-amber-500" />
        <span className="font-medium text-xs">Skill: {skillName || 'unknown'}</span>
        {args && (
          <code className="text-xs font-mono text-slate-400">{args}</code>
        )}
      </div>
      {output && (
        <pre className="bg-slate-50 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  );
}
```

### Step 4: Create tool renderer registry

Create `src/client/components/tools/index.ts` to map tool names to renderers:

```typescript
import type { ComponentType } from 'react';
import type { ToolExecution } from '../../types/session.js';
import { ReadRenderer } from './ReadRenderer.js';
import { EditRenderer } from './EditRenderer.js';
import { WriteRenderer } from './WriteRenderer.js';
import { BashRenderer } from './BashRenderer.js';
import { GlobRenderer } from './GlobRenderer.js';
import { GrepRenderer } from './GrepRenderer.js';
import { SkillRenderer } from './SkillRenderer.js';
import { DefaultRenderer } from './DefaultRenderer.js';

type ToolRendererComponent = ComponentType<{ execution: ToolExecution }>;

const rendererMap: Record<string, ToolRendererComponent> = {
  Read: ReadRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,
  Bash: BashRenderer,
  Glob: GlobRenderer,
  Grep: GrepRenderer,
  Skill: SkillRenderer,
  NotebookEdit: DefaultRenderer,
  WebFetch: DefaultRenderer,
  WebSearch: DefaultRenderer,
};

export function getToolRenderer(toolName: string): ToolRendererComponent {
  return rendererMap[toolName] || DefaultRenderer;
}
```

### Step 5: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 6: Commit

```bash
git add src/client/components/tools/GlobRenderer.tsx src/client/components/tools/GrepRenderer.tsx src/client/components/tools/SkillRenderer.tsx src/client/components/tools/index.ts
git commit -m "feat(web-server): add Glob, Grep, Skill renderers and tool registry"
```

---

## Task 7: LinkedToolItem — Collapsible Tool Card

**Goal:** Build the collapsible tool card that wraps tool renderers with summary, status, and duration.

**Files:**
- Create: `src/client/components/chat/items/LinkedToolItem.tsx`

### Step 1: Create `src/client/components/chat/items/LinkedToolItem.tsx`

```tsx
import { useState } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  FileText,
  Pencil,
  FilePlus,
  TerminalSquare,
  FolderSearch,
  Search,
  Zap,
  Wrench,
} from 'lucide-react';
import { generateToolSummary, formatDuration } from '../../../utils/session-formatters.js';
import { getToolRenderer } from '../../tools/index.js';
import type { ToolExecution } from '../../../types/session.js';

interface Props {
  execution: ToolExecution;
}

const toolIcons: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: Pencil,
  Write: FilePlus,
  Bash: TerminalSquare,
  Glob: FolderSearch,
  Grep: Search,
  Skill: Zap,
};

export function LinkedToolItem({ execution }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { toolName, input, result, durationMs, isOrphaned } = execution;

  const Icon = toolIcons[toolName] || Wrench;
  const summary = generateToolSummary(toolName, input);
  const isError = result?.isError ?? false;
  const ToolRenderer = getToolRenderer(toolName);

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 ${
        isError
          ? 'border-red-300 bg-red-50/30'
          : isOrphaned
            ? 'border-amber-300 bg-amber-50/30'
            : 'border-slate-200 bg-white'
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
            expanded ? 'rotate-90' : ''
          }`}
        />
        <Icon className={`w-4 h-4 flex-shrink-0 ${isError ? 'text-red-500' : 'text-slate-500'}`} />
        <span className="font-medium text-slate-700 text-xs">{toolName}</span>
        <span className="text-xs text-slate-500 truncate flex-1 text-left">{summary}</span>
        <span className="flex items-center gap-1.5 flex-shrink-0">
          {durationMs != null && (
            <span className="text-xs text-slate-400 flex items-center gap-0.5">
              <Clock className="w-3 h-3" />
              {formatDuration(durationMs)}
            </span>
          )}
          {isError ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : result ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : null}
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-slate-200">
          <ToolRenderer execution={execution} />
        </div>
      )}
    </div>
  );
}
```

### Step 2: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 3: Commit

```bash
git add src/client/components/chat/items/LinkedToolItem.tsx
git commit -m "feat(web-server): add LinkedToolItem collapsible tool card with renderers"
```

---

## Task 8: AIChunk — Renders SemanticSteps

**Goal:** Build the AI response chunk that renders thinking, text, tool calls, and subagent references in order.

**Files:**
- Create: `src/client/components/chat/AIChunk.tsx`

### Step 1: Create `src/client/components/chat/AIChunk.tsx`

This component renders an `EnhancedAIChunk` with its `semanticSteps` array. Each step type maps to a specific item component. Tool calls need `ToolExecution` objects — we build a lookup from the chunk's messages.

```tsx
import { Bot } from 'lucide-react';
import { formatTimestamp, formatTokenCount, formatDuration, formatCost } from '../../utils/session-formatters.js';
import { TextItem } from './items/TextItem.js';
import { ThinkingItem } from './items/ThinkingItem.js';
import { LinkedToolItem } from './items/LinkedToolItem.js';
import type {
  EnhancedAIChunk as EnhancedAIChunkType,
  AIChunk as AIChunkType,
  SemanticStep,
  ToolExecution,
  Process,
} from '../../types/session.js';

interface Props {
  chunk: AIChunkType;
  toolExecutions?: ToolExecution[];
  subagents?: Process[];
}

function isEnhanced(chunk: AIChunkType): chunk is EnhancedAIChunkType {
  return 'semanticSteps' in chunk;
}

export function AIChunk({ chunk, toolExecutions = [], subagents = [] }: Props) {
  const { messages, timestamp } = chunk;
  const enhanced = isEnhanced(chunk);

  // Build a lookup of tool executions by toolCallId
  const toolExecMap = new Map<string, ToolExecution>();
  for (const exec of toolExecutions) {
    toolExecMap.set(exec.toolCallId, exec);
  }

  // Calculate aggregate metrics from messages
  const totalTokens = messages.reduce((sum, m) => {
    if (m.usage) return sum + (m.usage.input_tokens || 0) + (m.usage.output_tokens || 0);
    return sum;
  }, 0);

  const model = messages.find((m) => m.model)?.model;

  // If not enhanced, fall back to rendering raw content
  if (!enhanced) {
    return (
      <div className="flex gap-2 mb-4">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
          <Bot className="w-4 h-4 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          {messages.map((msg, i) => {
            const text =
              typeof msg.content === 'string'
                ? msg.content
                : msg.content
                    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                    .map((b) => b.text)
                    .join('\n');
            return text ? <TextItem key={i} content={text} /> : null;
          })}
        </div>
      </div>
    );
  }

  // Enhanced: render semantic steps
  const steps = chunk.semanticSteps;

  return (
    <div className="flex gap-2 mb-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
        <Bot className="w-4 h-4 text-emerald-600" />
      </div>
      <div className="flex-1 min-w-0">
        {steps.map((step, i) => (
          <AIStepRenderer
            key={i}
            step={step}
            toolExecMap={toolExecMap}
          />
        ))}
        {/* Footer metrics */}
        <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
          {model && <span>{model}</span>}
          {totalTokens > 0 && <span>{formatTokenCount(totalTokens)} tokens</span>}
          <span>{formatTimestamp(timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

function AIStepRenderer({
  step,
  toolExecMap,
}: {
  step: SemanticStep;
  toolExecMap: Map<string, ToolExecution>;
}) {
  switch (step.type) {
    case 'thinking':
      return <ThinkingItem content={step.content} />;

    case 'output':
      return <TextItem content={step.content} />;

    case 'tool_call': {
      const exec = step.toolCallId ? toolExecMap.get(step.toolCallId) : undefined;
      if (exec) {
        // Task tool calls that resolve to subagents will be handled by SubagentItem in Task 10
        if (exec.toolName === 'Task') {
          // Placeholder until SubagentItem is built — render as default tool
          return <LinkedToolItem execution={exec} />;
        }
        return <LinkedToolItem execution={exec} />;
      }
      // No matching execution found — render minimal info
      return (
        <div className="text-xs text-slate-400 italic my-1">
          Tool call: {step.toolName || 'unknown'}{step.content ? ` — ${step.content}` : ''}
        </div>
      );
    }

    case 'tool_result':
      // Tool results are displayed as part of LinkedToolItem, skip standalone rendering
      return null;

    case 'subagent':
      // Will be handled by SubagentItem in Task 10
      return (
        <div className="text-xs text-slate-400 italic my-1 border border-slate-200 rounded px-2 py-1">
          Subagent: {step.subagentId || 'unknown'}
        </div>
      );

    case 'interruption':
      return (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 my-1">
          {step.content || 'Interrupted'}
        </div>
      );

    default:
      return step.content ? <TextItem content={step.content} /> : null;
  }
}
```

### Step 2: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 3: Commit

```bash
git add src/client/components/chat/AIChunk.tsx
git commit -m "feat(web-server): add AIChunk component rendering semantic steps"
```

---

## Task 9: ChatHistory — Virtual Scrolling Container

**Goal:** Build the main conversation view with conditional virtual scrolling and auto-scroll.

**Files:**
- Create: `src/client/components/chat/ChatHistory.tsx`

### Step 1: Create `src/client/components/chat/ChatHistory.tsx`

```tsx
import { useRef, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { UserChunk } from './UserChunk.js';
import { AIChunk } from './AIChunk.js';
import { SystemChunk } from './SystemChunk.js';
import { CompactChunk } from './CompactChunk.js';
import { useSessionViewStore } from '../../store/session-store.js';
import type { Chunk, ToolExecution, Process } from '../../types/session.js';

interface Props {
  chunks: Chunk[];
  toolExecutions?: ToolExecution[];
  subagents?: Process[];
}

const VIRTUALIZATION_THRESHOLD = 120;
const ESTIMATE_SIZE = 260;
const OVERSCAN = 8;
const NEAR_BOTTOM_PX = 100;

export function ChatHistory({ chunks, toolExecutions = [], subagents = [] }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const { isNearBottom, setIsNearBottom } = useSessionViewStore();
  const shouldVirtualize = chunks.length > VIRTUALIZATION_THRESHOLD;

  // Build tool execution lookup by chunk (AIChunks hold tool call IDs in their messages)
  // For simplicity, pass all tool executions to each AIChunk — they match by toolCallId internally
  const allToolExecs = toolExecutions;

  // Auto-scroll to bottom when new chunks arrive and user is near bottom
  const scrollToBottom = useCallback(() => {
    if (!parentRef.current) return;
    parentRef.current.scrollTop = parentRef.current.scrollHeight;
  }, []);

  useEffect(() => {
    if (isNearBottom) {
      scrollToBottom();
    }
  }, [chunks.length, isNearBottom, scrollToBottom]);

  // Track scroll position
  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    setIsNearBottom(distFromBottom < NEAR_BOTTOM_PX);
  }, [setIsNearBottom]);

  if (shouldVirtualize) {
    return (
      <VirtualizedList
        parentRef={parentRef}
        chunks={chunks}
        toolExecutions={allToolExecs}
        subagents={subagents}
        onScroll={handleScroll}
      />
    );
  }

  // Non-virtualized: render all chunks directly
  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      onScroll={handleScroll}
    >
      {chunks.map((chunk, i) => (
        <ChunkRenderer
          key={i}
          chunk={chunk}
          toolExecutions={allToolExecs}
          subagents={subagents}
        />
      ))}
    </div>
  );
}

function VirtualizedList({
  parentRef,
  chunks,
  toolExecutions,
  subagents,
  onScroll,
}: {
  parentRef: React.RefObject<HTMLDivElement | null>;
  chunks: Chunk[];
  toolExecutions: ToolExecution[];
  subagents: Process[];
  onScroll: () => void;
}) {
  const virtualizer = useVirtualizer({
    count: chunks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_SIZE,
    overscan: OVERSCAN,
  });

  return (
    <div
      ref={parentRef}
      className="flex-1 overflow-y-auto px-4"
      onScroll={onScroll}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <div className="py-3">
              <ChunkRenderer
                chunk={chunks[virtualItem.index]}
                toolExecutions={toolExecutions}
                subagents={subagents}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChunkRenderer({
  chunk,
  toolExecutions,
  subagents,
}: {
  chunk: Chunk;
  toolExecutions: ToolExecution[];
  subagents: Process[];
}) {
  switch (chunk.type) {
    case 'user':
      return <UserChunk chunk={chunk} />;
    case 'ai':
      return <AIChunk chunk={chunk} toolExecutions={toolExecutions} subagents={subagents} />;
    case 'system':
      return <SystemChunk chunk={chunk} />;
    case 'compact':
      return <CompactChunk chunk={chunk} />;
    default:
      return null;
  }
}
```

### Step 2: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 3: Commit

```bash
git add src/client/components/chat/ChatHistory.tsx
git commit -m "feat(web-server): add ChatHistory with conditional virtual scrolling and auto-scroll"
```

---

## Task 10: MetricsPill, ContextBadge, SubagentItem

**Goal:** Build the metrics display pill, context breakdown badge, and recursive subagent card.

**Files:**
- Create: `src/client/components/chat/MetricsPill.tsx`
- Create: `src/client/components/chat/context/ContextBadge.tsx`
- Create: `src/client/components/chat/items/SubagentItem.tsx`

### Step 1: Create `src/client/components/chat/MetricsPill.tsx`

```tsx
import { formatTokenCount } from '../../utils/session-formatters.js';

interface Props {
  mainTokens: number;
  subagentTokens?: number;
}

export function MetricsPill({ mainTokens, subagentTokens }: Props) {
  return (
    <span
      className="inline-flex items-center bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 text-xs font-mono"
      title={`Main: ${mainTokens.toLocaleString()} tokens${subagentTokens ? ` | Subagent: ${subagentTokens.toLocaleString()} tokens` : ''}`}
    >
      {formatTokenCount(mainTokens)}
      {subagentTokens != null && subagentTokens > 0 && (
        <>
          <span className="text-slate-400 mx-1">|</span>
          {formatTokenCount(subagentTokens)}
        </>
      )}
    </span>
  );
}
```

### Step 2: Create `src/client/components/chat/context/ContextBadge.tsx`

```tsx
import { useState, useRef } from 'react';
import { Layers } from 'lucide-react';
import { formatTokenCount } from '../../../utils/session-formatters.js';

interface ContextCategory {
  label: string;
  tokens: number;
}

interface Props {
  totalNewTokens: number;
  categories?: ContextCategory[];
}

export function ContextBadge({ totalNewTokens, categories = [] }: Props) {
  const [showPopover, setShowPopover] = useState(false);
  const badgeRef = useRef<HTMLDivElement>(null);

  if (totalNewTokens === 0) return null;

  return (
    <div className="relative inline-block" ref={badgeRef}>
      <button
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className="inline-flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 hover:bg-indigo-100 transition-colors"
      >
        <Layers className="w-3 h-3" />
        Context +{formatTokenCount(totalNewTokens)}
      </button>
      {showPopover && categories.length > 0 && (
        <div className="absolute z-50 bottom-full left-0 mb-1 w-64 bg-white rounded-lg shadow-lg border border-slate-200 p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Context Breakdown</div>
          <div className="space-y-1.5">
            {categories.map((cat) => (
              <div key={cat.label} className="flex justify-between text-xs">
                <span className="text-slate-600">{cat.label}</span>
                <span className="font-mono text-slate-800">{formatTokenCount(cat.tokens)}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between text-xs font-medium">
            <span className="text-slate-700">Total</span>
            <span className="font-mono text-slate-900">{formatTokenCount(totalNewTokens)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 3: Create `src/client/components/chat/items/SubagentItem.tsx`

This is the most complex component — supports multi-level expansion and recursive rendering.

```tsx
import { useState } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  Loader2,
  Search,
  FileCode,
  LayoutList,
  Bot,
} from 'lucide-react';
import { MetricsPill } from '../MetricsPill.js';
import { formatDuration } from '../../../utils/session-formatters.js';
import { TextItem } from './TextItem.js';
import { ThinkingItem } from './ThinkingItem.js';
import { LinkedToolItem } from './LinkedToolItem.js';
import type { Process, ToolExecution } from '../../../types/session.js';

interface Props {
  process: Process;
  toolExecutions?: ToolExecution[];
  depth?: number;
}

const typeIcons: Record<string, typeof Bot> = {
  Explore: Search,
  Plan: LayoutList,
  'general-purpose': FileCode,
};

const typeColors: Record<string, string> = {
  Explore: 'text-blue-600 bg-blue-100',
  Plan: 'text-purple-600 bg-purple-100',
  'general-purpose': 'text-green-600 bg-green-100',
};

export function SubagentItem({ process, toolExecutions = [], depth = 0 }: Props) {
  const [expandedMeta, setExpandedMeta] = useState(false);
  const [expandedTrace, setExpandedTrace] = useState(false);

  const Icon = typeIcons[process.subagentType || ''] || Bot;
  const colorClass = typeColors[process.subagentType || ''] || 'text-slate-600 bg-slate-100';
  const isOngoing = process.isOngoing ?? false;

  const mainTokens = process.metrics.totalTokens;
  const description = process.description || process.subagentType || 'Subagent';
  const truncatedDesc = description.length > 60 ? description.slice(0, 57) + '…' : description;

  return (
    <div
      className={`border rounded-lg overflow-hidden my-2 ${
        depth > 0 ? 'ml-4 border-slate-200' : 'border-indigo-200 bg-indigo-50/20'
      }`}
    >
      {/* Level 1: Header */}
      <button
        onClick={() => setExpandedMeta(!expandedMeta)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 text-slate-400 transition-transform flex-shrink-0 ${
            expandedMeta ? 'rotate-90' : ''
          }`}
        />
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
          <Icon className="w-3 h-3" />
          {process.subagentType || 'agent'}
        </span>
        <span className="text-xs text-slate-600 truncate flex-1 text-left">{truncatedDesc}</span>
        <MetricsPill mainTokens={mainTokens} />
        {process.durationMs > 0 && (
          <span className="text-xs text-slate-400">{formatDuration(process.durationMs)}</span>
        )}
        {isOngoing ? (
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4 text-green-500" />
        )}
      </button>

      {/* Level 1 Expanded: Meta info */}
      {expandedMeta && (
        <div className="px-4 py-3 border-t border-slate-200 bg-white/50 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500">Type:</span>{' '}
              <span className="text-slate-800">{process.subagentType || 'unknown'}</span>
            </div>
            <div>
              <span className="text-slate-500">Duration:</span>{' '}
              <span className="text-slate-800">{formatDuration(process.durationMs)}</span>
            </div>
            <div>
              <span className="text-slate-500">Agent ID:</span>{' '}
              <span className="font-mono text-slate-800">{process.id.slice(0, 8)}</span>
            </div>
            <div>
              <span className="text-slate-500">Tokens:</span>{' '}
              <span className="text-slate-800">{process.metrics.totalTokens.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-500">Tool Calls:</span>{' '}
              <span className="text-slate-800">{process.metrics.toolCallCount}</span>
            </div>
            <div>
              <span className="text-slate-500">Turns:</span>{' '}
              <span className="text-slate-800">{process.metrics.turnCount}</span>
            </div>
          </div>

          {/* Level 2: Execution trace toggle */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpandedTrace(!expandedTrace);
            }}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <ChevronRight
              className={`w-3 h-3 transition-transform ${expandedTrace ? 'rotate-90' : ''}`}
            />
            {expandedTrace ? 'Hide' : 'Show'} execution trace ({process.messages.length} messages)
          </button>

          {/* Level 2 Expanded: Full execution trace */}
          {expandedTrace && (
            <div className="border-t border-slate-200 pt-3 space-y-2">
              {process.messages.map((msg, i) => {
                if (msg.role === 'user' || msg.type === 'user') {
                  const text =
                    typeof msg.content === 'string'
                      ? msg.content
                      : msg.content
                          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
                          .map((b) => b.text)
                          .join('\n');
                  return text ? (
                    <div key={i} className="text-xs text-slate-500 bg-blue-50 rounded px-2 py-1">
                      {text.slice(0, 200)}{text.length > 200 ? '…' : ''}
                    </div>
                  ) : null;
                }

                // Assistant messages: render thinking and text content
                if (msg.type === 'assistant' && Array.isArray(msg.content)) {
                  return (
                    <div key={i} className="space-y-1">
                      {msg.content.map((block, j) => {
                        if (block.type === 'thinking' && 'thinking' in block) {
                          return <ThinkingItem key={j} content={(block as { thinking: string }).thinking} />;
                        }
                        if (block.type === 'text' && 'text' in block) {
                          return <TextItem key={j} content={(block as { text: string }).text} />;
                        }
                        if (block.type === 'tool_use') {
                          // Find matching tool execution
                          const toolBlock = block as { id: string; name: string; input: Record<string, unknown> };
                          const exec = toolExecutions.find((e) => e.toolCallId === toolBlock.id);
                          if (exec) return <LinkedToolItem key={j} execution={exec} />;
                          return (
                            <div key={j} className="text-xs text-slate-400 italic">
                              Tool: {toolBlock.name}
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 4: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 5: Commit

```bash
git add src/client/components/chat/MetricsPill.tsx src/client/components/chat/context/ContextBadge.tsx src/client/components/chat/items/SubagentItem.tsx
git commit -m "feat(web-server): add MetricsPill, ContextBadge, SubagentItem components"
```

---

## Task 11: SessionContextPanel — Right Sidebar

**Goal:** Build the right sidebar panel showing session summary, cumulative context tracking, and compaction timeline.

**Files:**
- Create: `src/client/components/chat/context/SessionContextPanel.tsx`

### Step 1: Create `src/client/components/chat/context/SessionContextPanel.tsx`

```tsx
import {
  Clock,
  DollarSign,
  MessageSquare,
  Wrench,
  Layers,
  Cpu,
  TrendingUp,
} from 'lucide-react';
import { formatTokenCount, formatDuration, formatCost } from '../../../utils/session-formatters.js';
import type { SessionMetrics, Chunk } from '../../../types/session.js';

interface Props {
  metrics: SessionMetrics;
  chunks: Chunk[];
  model?: string;
}

export function SessionContextPanel({ metrics, chunks, model }: Props) {
  const compactionCount = chunks.filter((c) => c.type === 'compact').length;

  return (
    <div className="h-full overflow-y-auto bg-white border-l border-slate-200 p-4 space-y-6">
      {/* Session Summary */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Session Summary</h3>
        <div className="space-y-2">
          {model && (
            <SummaryRow icon={Cpu} label="Model" value={model} />
          )}
          <SummaryRow
            icon={MessageSquare}
            label="Turns"
            value={String(metrics.turnCount)}
          />
          <SummaryRow
            icon={Wrench}
            label="Tool Calls"
            value={String(metrics.toolCallCount)}
          />
          <SummaryRow
            icon={Clock}
            label="Duration"
            value={formatDuration(metrics.duration)}
          />
          <SummaryRow
            icon={DollarSign}
            label="Cost"
            value={formatCost(metrics.totalCost)}
          />
        </div>
      </div>

      {/* Token Breakdown */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Token Usage</h3>
        <div className="space-y-2">
          <TokenRow label="Total" tokens={metrics.totalTokens} isTotal />
          <TokenRow label="Input" tokens={metrics.inputTokens} />
          <TokenRow label="Output" tokens={metrics.outputTokens} />
          {metrics.cacheReadTokens > 0 && (
            <TokenRow label="Cache Read" tokens={metrics.cacheReadTokens} />
          )}
          {metrics.cacheCreationTokens > 0 && (
            <TokenRow label="Cache Write" tokens={metrics.cacheCreationTokens} />
          )}
        </div>
      </div>

      {/* Compaction Timeline */}
      {compactionCount > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            <Layers className="w-4 h-4 inline mr-1" />
            Compactions
          </h3>
          <div className="text-xs text-slate-600">
            {compactionCount} context compaction{compactionCount > 1 ? 's' : ''} occurred during this session.
          </div>
          {/* Visual timeline */}
          <div className="mt-2 flex items-center gap-1">
            {chunks.map((chunk, i) => (
              <div
                key={i}
                className={`h-2 flex-1 rounded-sm ${
                  chunk.type === 'compact'
                    ? 'bg-amber-400'
                    : 'bg-slate-200'
                }`}
                title={chunk.type === 'compact' ? `Compaction at position ${i}` : undefined}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>Start</span>
            <span>End</span>
          </div>
        </div>
      )}

      {/* Session Progress */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          <TrendingUp className="w-4 h-4 inline mr-1" />
          Activity
        </h3>
        <div className="text-xs text-slate-600 space-y-1">
          <div>{chunks.filter((c) => c.type === 'user').length} user messages</div>
          <div>{chunks.filter((c) => c.type === 'ai').length} AI responses</div>
          <div>{chunks.filter((c) => c.type === 'system').length} system events</div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <span className="text-slate-500 flex-1">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

function TokenRow({
  label,
  tokens,
  isTotal = false,
}: {
  label: string;
  tokens: number;
  isTotal?: boolean;
}) {
  return (
    <div className={`flex justify-between text-xs ${isTotal ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{formatTokenCount(tokens)}</span>
    </div>
  );
}
```

### Step 2: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 3: Commit

```bash
git add src/client/components/chat/context/SessionContextPanel.tsx
git commit -m "feat(web-server): add SessionContextPanel with metrics, tokens, and compaction timeline"
```

---

## Task 12: SessionDetail Page — Top-Level Composition

**Goal:** Build the SessionDetail page that composes ChatHistory + SessionContextPanel, fetches data from the API, and is accessible at `/sessions/:projectId/:sessionId`.

**Files:**
- Modify: `src/client/pages/SessionDetail.tsx` (already exists as stub)
- Modify: `src/client/App.tsx` (add route if not present)

### Step 1: Read existing `src/client/pages/SessionDetail.tsx` and `src/client/App.tsx`

Understand the current stub and routing setup before replacing.

### Step 2: Replace `src/client/pages/SessionDetail.tsx`

```tsx
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ChatHistory } from '../components/chat/ChatHistory.js';
import { SessionContextPanel } from '../components/chat/context/SessionContextPanel.js';
import { useSessionDetail } from '../api/hooks.js';
import { formatDuration, formatCost, formatTokenCount } from '../utils/session-formatters.js';
import { useSessionViewStore } from '../store/session-store.js';
import { useEffect } from 'react';
import type { EnhancedAIChunk, ToolExecution } from '../types/session.js';

export default function SessionDetail() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const navigate = useNavigate();
  const resetView = useSessionViewStore((s) => s.resetView);

  // Reset view state when session changes
  useEffect(() => {
    resetView();
  }, [projectId, sessionId, resetView]);

  const {
    data: session,
    isLoading,
    error,
  } = useSessionDetail(projectId || '', sessionId || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="ml-3 text-slate-600">Loading session…</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-slate-600">Failed to load session</p>
          <p className="text-sm text-slate-400 mt-1">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  const { chunks, metrics, subagents } = session;

  // Extract all tool executions from enhanced AI chunks
  const toolExecutions: ToolExecution[] = [];
  for (const chunk of chunks) {
    if (chunk.type === 'ai' && 'semanticSteps' in chunk) {
      const enhanced = chunk as EnhancedAIChunk;
      // Build tool executions from the chunk's messages
      for (const msg of enhanced.messages) {
        for (const tc of msg.toolCalls) {
          const matchingResult = msg.toolResults.find((r) => r.toolUseId === tc.id)
            || enhanced.messages.flatMap((m) => m.toolResults).find((r) => r.toolUseId === tc.id);
          toolExecutions.push({
            toolCallId: tc.id,
            toolName: tc.name,
            input: tc.input,
            result: matchingResult || undefined,
            startTime: msg.timestamp,
            endTime: undefined,
            durationMs: undefined,
            isOrphaned: false,
          });
        }
      }
    }
  }

  // Detect model from first assistant message
  const model = chunks
    .filter((c) => c.type === 'ai')
    .flatMap((c) => (c as { messages: Array<{ model?: string }> }).messages)
    .find((m) => m.model)?.model;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: session metadata */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-200 bg-white">
        <button
          onClick={() => navigate(-1)}
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-slate-800 truncate">
            Session {sessionId?.slice(0, 8)}
          </h1>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {model && <span>{model}</span>}
            <span>{formatDuration(metrics.duration)}</span>
            <span>{formatTokenCount(metrics.totalTokens)} tokens</span>
            <span>{formatCost(metrics.totalCost)}</span>
            {session.isOngoing && (
              <span className="text-blue-600 font-medium">Live</span>
            )}
          </div>
        </div>
      </div>

      {/* Main content: chat + context panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: chat history (~70%) */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatHistory
            chunks={chunks}
            toolExecutions={toolExecutions}
            subagents={subagents}
          />
        </div>

        {/* Right panel: context (~30%) */}
        <div className="w-80 flex-shrink-0 hidden lg:block">
          <SessionContextPanel
            metrics={metrics}
            chunks={chunks}
            model={model}
          />
        </div>
      </div>
    </div>
  );
}
```

### Step 3: Add route for SessionDetail in App.tsx

If not already present, add:
```tsx
import SessionDetail from './pages/SessionDetail.js';
// Inside Routes:
<Route path="/sessions/:projectId/:sessionId" element={<SessionDetail />} />
```

Read `App.tsx` first to see if this route already exists.

### Step 4: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 5: Commit

```bash
git add src/client/pages/SessionDetail.tsx src/client/App.tsx
git commit -m "feat(web-server): add SessionDetail page with chat history and context panel"
```

---

## Task 13: Session Tab in Stage Drawer + Integration

**Goal:** Wire session viewing into the existing stage drawer system. When a stage has a linked `session_id`, show a "Session" tab in `StageDetailContent`. Also add session navigation from the board.

**Files:**
- Modify: `src/client/components/detail/StageDetailContent.tsx`
- Modify: `src/client/components/detail/DrawerHost.tsx` (if needed for new drawer type)

### Step 1: Read existing StageDetailContent.tsx

Understand the current structure and the session link placeholder.

### Step 2: Add Session tab to StageDetailContent

The stage API already returns `session_id: string | null`. When present, show a "Session" tab that opens the session detail page in a new browser tab or navigates to `/sessions/:projectId/:sessionId`.

Add to `StageDetailContent.tsx`:

```tsx
// Add import at top:
import { ExternalLink } from 'lucide-react';

// Find the disabled session link placeholder and replace it with:
{stage.session_id && (
  <a
    href={`/sessions/${encodeURIComponent(stage.session_id.split('/').slice(0, -1).join('/') || 'default')}/${stage.session_id.split('/').pop() || stage.session_id}`}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors text-sm"
  >
    <ExternalLink className="w-4 h-4" />
    View Session
  </a>
)}
```

Note: The exact implementation depends on how `session_id` is formatted. Read the actual data shape from the stage API response to determine the correct URL construction. The `session_id` may already be just the session UUID, in which case we need the project ID from another source.

### Step 3: Verify no TypeScript errors

Run: `cd tools/web-server && npx tsc --noEmit`

### Step 4: Commit

```bash
git add src/client/components/detail/StageDetailContent.tsx
git commit -m "feat(web-server): add session link to StageDetailContent when session_id available"
```

---

## Task 14: Final Integration, Polish & Verification

**Goal:** Wire everything together, fix TypeScript errors, run full test suite, ensure all existing tests pass.

**Files:**
- Potentially modify any file with TypeScript errors
- Run: `cd tools/web-server && npm run verify` (lint + all tests)

### Step 1: Run TypeScript check

Run: `cd tools/web-server && npx tsc --noEmit`

Fix any type errors found.

### Step 2: Run linter

Run: `cd tools/web-server && npm run lint`

Fix any lint issues.

### Step 3: Run all tests

Run: `cd tools/web-server && npm run test`

Verify all 248+ existing tests pass plus new formatter tests.

### Step 4: Run full verification

Run: `cd tools/web-server && npm run verify`

Expected: All checks pass.

### Step 5: Cross-package verification

Run: `cd tools/kanban-cli && npm run verify` and `cd tools/orchestrator && npm run verify`

Verify no regressions in other packages.

### Step 6: Final commit

```bash
git add -A
git commit -m "feat(web-server): Stage 9F complete — session detail display with chat history, tool renderers, and context panel"
```

---

## Summary: Component → File Mapping

| # | Component | File |
|---|-----------|------|
| 1 | Session types re-export | `src/client/types/session.ts` |
| 2 | Session formatters | `src/client/utils/session-formatters.ts` |
| 3 | Session view store | `src/client/store/session-store.ts` |
| 4 | React Query hooks | `src/client/api/hooks.ts` (modified) |
| 5 | UserChunk | `src/client/components/chat/UserChunk.tsx` |
| 6 | SystemChunk | `src/client/components/chat/SystemChunk.tsx` |
| 7 | CompactChunk | `src/client/components/chat/CompactChunk.tsx` |
| 8 | TextItem | `src/client/components/chat/items/TextItem.tsx` |
| 9 | ThinkingItem | `src/client/components/chat/items/ThinkingItem.tsx` |
| 10 | DefaultRenderer | `src/client/components/tools/DefaultRenderer.tsx` |
| 11 | ReadRenderer | `src/client/components/tools/ReadRenderer.tsx` |
| 12 | EditRenderer | `src/client/components/tools/EditRenderer.tsx` |
| 13 | WriteRenderer | `src/client/components/tools/WriteRenderer.tsx` |
| 14 | BashRenderer | `src/client/components/tools/BashRenderer.tsx` |
| 15 | GlobRenderer | `src/client/components/tools/GlobRenderer.tsx` |
| 16 | GrepRenderer | `src/client/components/tools/GrepRenderer.tsx` |
| 17 | SkillRenderer | `src/client/components/tools/SkillRenderer.tsx` |
| 18 | Tool registry | `src/client/components/tools/index.ts` |
| 19 | LinkedToolItem | `src/client/components/chat/items/LinkedToolItem.tsx` |
| 20 | AIChunk | `src/client/components/chat/AIChunk.tsx` |
| 21 | ChatHistory | `src/client/components/chat/ChatHistory.tsx` |
| 22 | MetricsPill | `src/client/components/chat/MetricsPill.tsx` |
| 23 | ContextBadge | `src/client/components/chat/context/ContextBadge.tsx` |
| 24 | SubagentItem | `src/client/components/chat/items/SubagentItem.tsx` |
| 25 | SessionContextPanel | `src/client/components/chat/context/SessionContextPanel.tsx` |
| 26 | SessionDetail page | `src/client/pages/SessionDetail.tsx` (modified) |
| 27 | StageDetailContent | `src/client/components/detail/StageDetailContent.tsx` (modified) |
| 28 | Formatter tests | `tests/client/session-formatters.test.ts` |

**Total: 26 new files + 2 modified files + 1 test file**
