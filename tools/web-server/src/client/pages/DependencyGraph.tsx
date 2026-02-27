import { useState, useEffect, useRef, useCallback } from 'react';
// Mermaid types don't expose render() on the module, so we need this
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import mermaid from 'mermaid';
import { useGraphMermaid, useGraph, useEpics } from '../api/hooks.js';
import { AlertTriangle, Loader2, AlertCircle } from 'lucide-react';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  flowchart: { useMaxWidth: true, htmlLabels: true },
});

export function DependencyGraph() {
  const [epicFilter, setEpicFilter] = useState<string>('');
  const [showCompleted, setShowCompleted] = useState(true);
  const [showCriticalPath, setShowCriticalPath] = useState(false);

  const epicFilters = epicFilter ? { epic: epicFilter } : undefined;

  const {
    data: mermaidData,
    isLoading: mermaidLoading,
    error: mermaidError,
  } = useGraphMermaid(epicFilters);
  const { data: graphData } = useGraph(epicFilters);
  const { data: epics } = useEpics();

  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);

  const renderGraph = useCallback(async (mermaidStr: string) => {
    if (!containerRef.current) return;
    const currentId = ++renderIdRef.current;
    try {
      containerRef.current.innerHTML = '';
      // Mermaid render() is async and not exposed in types
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { svg } = await (mermaid as any).render(
        `dep-graph-${currentId}`,
        mermaidStr,
      );
      if (renderIdRef.current === currentId && containerRef.current) {
        containerRef.current.innerHTML = svg;
      }
    } catch {
      if (renderIdRef.current === currentId && containerRef.current) {
        containerRef.current.innerHTML =
          '<p class="text-sm text-red-500">Failed to render graph</p>';
      }
    }
  }, []);

  useEffect(() => {
    if (mermaidData?.mermaid) {
      renderGraph(mermaidData.mermaid);
    }
  }, [mermaidData?.mermaid, renderGraph]);

  const cycles = graphData?.cycles ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Dependency Graph</h1>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={epicFilter}
          onChange={(e) => setEpicFilter(e.target.value)}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
        >
          <option value="">All Epics</option>
          {(epics ?? []).map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.id} — {ep.title}
            </option>
          ))}
        </select>

        {/* TODO: Add ticket filter dropdown when API supports ?ticket= param */}

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="rounded border-slate-300"
            disabled
          />
          Show completed
          <span className="text-xs">(coming soon)</span>
        </label>

        <label className="flex items-center gap-1.5 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={showCriticalPath}
            onChange={(e) => setShowCriticalPath(e.target.checked)}
            className="rounded border-slate-300"
            disabled
          />
          Critical path
          <span className="text-xs">(coming soon)</span>
        </label>
      </div>

      {/* Cycle warnings */}
      {cycles.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Dependency cycles detected:</strong>
            <ul className="mt-1 list-inside list-disc">
              {cycles.map((cycle, i) => (
                <li key={i}>
                  {cycle.join(' → ')} → {cycle[0]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Graph */}
      {mermaidLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      ) : mermaidError ? (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          Failed to load graph: {mermaidError.message}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="overflow-auto rounded-lg border border-slate-200 bg-white p-4"
        />
      )}

      {/* TODO: Implement client-side filtering for completed items and critical path highlighting */}
    </div>
  );
}
