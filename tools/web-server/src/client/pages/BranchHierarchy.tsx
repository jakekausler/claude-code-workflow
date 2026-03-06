import { useState, useMemo, useCallback } from 'react';
import { Loader2, AlertCircle, GitFork, ExternalLink, AlertTriangle } from 'lucide-react';
import { useBoard } from '../api/hooks.js';
import type { BoardStageItem, PendingMergeParent } from '../api/hooks.js';
import { useDrawerStore } from '../store/drawer-store.js';

// ---------------------------------------------------------------------------
// DAG data model
// ---------------------------------------------------------------------------

interface BranchNode {
  id: string; // branch name (or "main" for synthetic root)
  label: string;
  stageId?: string;
  stageTitle?: string;
  prUrl?: string;
  prNumber?: number;
  repo?: string;
  parentBranches: string[]; // parent branch ids
}

interface LayoutNode extends BranchNode {
  x: number;
  y: number;
  col: number;
  row: number;
}

interface EdgeInfo {
  fromId: string;
  toId: string;
}

// ---------------------------------------------------------------------------
// Build DAG from board data
// ---------------------------------------------------------------------------

function buildDAG(
  stages: BoardStageItem[],
  repoFilter: string,
): { nodes: BranchNode[]; edges: EdgeInfo[] } {
  const nodeMap = new Map<string, BranchNode>();

  // Synthetic root
  nodeMap.set('main', {
    id: 'main',
    label: 'main',
    parentBranches: [],
  });

  const filteredStages = repoFilter
    ? stages.filter((s) => s.repo === repoFilter)
    : stages;

  for (const stage of filteredStages) {
    if (!stage.worktree_branch) continue;

    const branch = stage.worktree_branch;
    const existing = nodeMap.get(branch);

    const pendingParents: PendingMergeParent[] = stage.pending_merge_parents ?? [];
    const parentBranches: string[] = pendingParents.map((p) => p.branch);

    if (!existing) {
      nodeMap.set(branch, {
        id: branch,
        label: branch,
        stageId: stage.id,
        stageTitle: stage.title,
        prUrl: pendingParents[0]?.pr_url,
        prNumber: pendingParents[0]?.pr_number,
        repo: stage.repo,
        parentBranches,
      });
    } else {
      existing.stageId = existing.stageId ?? stage.id;
      existing.stageTitle = existing.stageTitle ?? stage.title;
      existing.repo = existing.repo ?? stage.repo;
      if (parentBranches.length > 0) {
        existing.parentBranches = [
          ...new Set([...existing.parentBranches, ...parentBranches]),
        ];
      }
    }

    // Ensure parent nodes exist even if they have no stage
    for (const parentBranch of parentBranches) {
      if (!nodeMap.has(parentBranch)) {
        nodeMap.set(parentBranch, {
          id: parentBranch,
          label: parentBranch,
          parentBranches: [],
        });
      }
    }
  }

  // Branches without explicit parents connect to main
  for (const node of nodeMap.values()) {
    if (node.id !== 'main' && node.parentBranches.length === 0) {
      node.parentBranches = ['main'];
    }
  }

  const nodes = Array.from(nodeMap.values());
  const edges: EdgeInfo[] = [];
  for (const node of nodes) {
    for (const parentId of node.parentBranches) {
      if (nodeMap.has(parentId)) {
        edges.push({ fromId: parentId, toId: node.id });
      }
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn's algorithm)
// ---------------------------------------------------------------------------

function topoSort(nodes: BranchNode[], edges: EdgeInfo[]): BranchNode[] {
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const children = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of edges) {
    inDegree.set(edge.toId, (inDegree.get(edge.toId) ?? 0) + 1);
    children.get(edge.fromId)?.push(edge.toId);
  }

  const queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id);

  const sorted: string[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const childId of children.get(id) ?? []) {
      const deg = (inDegree.get(childId) ?? 1) - 1;
      inDegree.set(childId, deg);
      if (deg === 0) queue.push(childId);
    }
  }

  // Append any remaining (cycle members) at end
  const sortedSet = new Set(sorted);
  for (const n of nodes) {
    if (!sortedSet.has(n.id)) sorted.push(n.id);
  }

  return sorted.map((id) => nodeById.get(id)!).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Layout: left-to-right DAG
// ---------------------------------------------------------------------------

const NODE_W = 200;
const NODE_H = 64;
const H_GAP = 80;
const V_GAP = 24;

function computeLayout(
  nodes: BranchNode[],
  edges: EdgeInfo[],
): { layoutNodes: LayoutNode[]; svgWidth: number; svgHeight: number } {
  const sorted = topoSort(nodes, edges);

  const colMap = new Map<string, number>();
  const parentEdges = new Map<string, string[]>();
  for (const n of nodes) parentEdges.set(n.id, []);
  for (const e of edges) parentEdges.get(e.toId)?.push(e.fromId);

  colMap.set('main', 0);
  for (const node of sorted) {
    const parents = parentEdges.get(node.id) ?? [];
    if (parents.length === 0) {
      colMap.set(node.id, colMap.get(node.id) ?? 0);
    } else {
      const maxParentCol = Math.max(...parents.map((p) => colMap.get(p) ?? 0));
      colMap.set(node.id, maxParentCol + 1);
    }
  }

  const colGroups = new Map<number, string[]>();
  for (const node of sorted) {
    const col = colMap.get(node.id) ?? 0;
    if (!colGroups.has(col)) colGroups.set(col, []);
    colGroups.get(col)!.push(node.id);
  }

  const rowMap = new Map<string, number>();
  for (const [, ids] of colGroups) {
    ids.forEach((id, i) => rowMap.set(id, i));
  }

  const maxCol = Math.max(...Array.from(colMap.values()), 0);
  const maxRow = Math.max(
    ...Array.from(colGroups.values()).map((g) => g.length),
    1,
  );

  const svgWidth = (maxCol + 1) * (NODE_W + H_GAP) + 40;
  const svgHeight = maxRow * (NODE_H + V_GAP) + 40;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const layoutNodes: LayoutNode[] = sorted.map((n) => {
    const col = colMap.get(n.id) ?? 0;
    const row = rowMap.get(n.id) ?? 0;
    return {
      ...nodeById.get(n.id)!,
      col,
      row,
      x: 20 + col * (NODE_W + H_GAP),
      y: 20 + row * (NODE_H + V_GAP),
    };
  });

  return { layoutNodes, svgWidth, svgHeight };
}

// ---------------------------------------------------------------------------
// Critical path: nodes that have children (blocking others)
// ---------------------------------------------------------------------------

function getCriticalNodeIds(edges: EdgeInfo[]): Set<string> {
  const parents = new Set<string>();
  for (const e of edges) parents.add(e.fromId);
  parents.delete('main');
  return parents;
}

// ---------------------------------------------------------------------------
// SVG Edge
// ---------------------------------------------------------------------------

function Edge({ from, to }: { from: LayoutNode; to: LayoutNode }) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const cx1 = x1 + H_GAP / 2;
  const cx2 = x2 - H_GAP / 2;
  return (
    <path
      d={`M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke="#94a3b8"
      strokeWidth={1.5}
      markerEnd="url(#arrow)"
    />
  );
}

// ---------------------------------------------------------------------------
// SVG Node
// ---------------------------------------------------------------------------

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

function NodeRect({
  node,
  isCritical,
  isMain,
  onClick,
}: {
  node: LayoutNode;
  isCritical: boolean;
  isMain: boolean;
  onClick?: () => void;
}) {
  const hasPr = Boolean(node.prUrl);
  const bgColor = isMain ? '#1e293b' : isCritical ? '#fff7ed' : '#f8fafc';
  const borderColor = isMain ? '#1e293b' : isCritical ? '#f97316' : '#e2e8f0';
  const textColor = isMain ? '#f8fafc' : '#1e293b';
  const subTextColor = isMain ? '#94a3b8' : '#64748b';

  return (
    <g
      transform={`translate(${node.x}, ${node.y})`}
      onClick={node.stageId ? onClick : undefined}
      style={{ cursor: node.stageId ? 'pointer' : 'default' }}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={8}
        fill={bgColor}
        stroke={borderColor}
        strokeWidth={isMain ? 0 : 1.5}
      />
      <text
        x={NODE_W / 2}
        y={node.stageTitle ? 22 : NODE_H / 2 + 5}
        textAnchor="middle"
        fontSize={11}
        fontWeight="600"
        fill={textColor}
        fontFamily="ui-monospace, monospace"
      >
        {truncate(node.label, 22)}
      </text>
      {node.stageTitle && (
        <text
          x={NODE_W / 2}
          y={40}
          textAnchor="middle"
          fontSize={10}
          fill={subTextColor}
          fontFamily="ui-sans-serif, sans-serif"
        >
          {truncate(node.stageTitle, 26)}
        </text>
      )}
      {hasPr && (
        <g transform={`translate(${NODE_W - 28}, 4)`}>
          <rect width={24} height={16} rx={4} fill="#22c55e" opacity={0.15} />
          <text x={12} y={12} textAnchor="middle" fontSize={9} fontWeight="700" fill="#16a34a" fontFamily="ui-sans-serif, sans-serif">
            PR
          </text>
        </g>
      )}
      {isCritical && !isMain && (
        <g transform="translate(4, 4)">
          <rect width={16} height={16} rx={4} fill="#f97316" opacity={0.15} />
          <text x={8} y={12} textAnchor="middle" fontSize={10} fill="#ea580c" fontFamily="ui-sans-serif, sans-serif">
            !
          </text>
        </g>
      )}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BranchHierarchy() {
  const { data: board, isLoading, error } = useBoard();
  const open = useDrawerStore((s) => s.open);
  const [repoFilter, setRepoFilter] = useState<string>('');

  const allStages = useMemo((): BoardStageItem[] => {
    if (!board) return [];
    return Object.values(board.columns)
      .flat()
      .filter((item): item is BoardStageItem => item.type === 'stage');
  }, [board]);

  const repos = useMemo((): string[] => {
    if (board?.repos) return board.repos;
    const seen = new Set<string>();
    for (const s of allStages) {
      if (s.repo) seen.add(s.repo);
    }
    return Array.from(seen).sort();
  }, [board, allStages]);

  const { nodes, edges } = useMemo(
    () => buildDAG(allStages, repoFilter),
    [allStages, repoFilter],
  );

  const { layoutNodes, svgWidth, svgHeight } = useMemo(
    () => computeLayout(nodes, edges),
    [nodes, edges],
  );

  const criticalIds = useMemo(() => getCriticalNodeIds(edges), [edges]);

  const layoutNodeMap = useMemo(
    () => new Map(layoutNodes.map((n) => [n.id, n])),
    [layoutNodes],
  );

  const handleNodeClick = useCallback(
    (node: LayoutNode) => {
      if (node.stageId) open({ type: 'stage', id: node.stageId });
    },
    [open],
  );

  const branchNodes = layoutNodes.filter((n) => n.id !== 'main');
  const hasAnyBranch = branchNodes.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <GitFork size={22} className="text-slate-600" />
        <h1 className="text-2xl font-bold text-slate-900">Branch Hierarchy</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {repos.length > 1 && (
          <select
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="">All Repos</option>
            {repos.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded border border-orange-400 bg-orange-50" />
            Blocking others
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-green-100" />
            Has open PR
          </span>
          <span>Click node to open stage</span>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="animate-spin text-slate-400" size={28} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} />
          Failed to load board data: {(error as Error).message}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && !hasAnyBranch && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-20 text-center">
          <GitFork size={40} className="mb-4 text-slate-300" />
          <p className="text-lg font-medium text-slate-600">No active branches</p>
          <p className="mt-1 text-sm text-slate-400">
            Stages with a{' '}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">worktree_branch</code>{' '}
            will appear here.
          </p>
        </div>
      )}

      {/* DAG + table */}
      {!isLoading && !error && hasAnyBranch && (
        <>
          {criticalIds.size > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong>{criticalIds.size}</strong>{' '}
                {criticalIds.size > 1 ? 'branches are' : 'branch is'} blocking other branches
                (highlighted in orange).
              </span>
            </div>
          )}

          <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-2">
            <svg width={svgWidth} height={svgHeight} style={{ display: 'block', minWidth: svgWidth }}>
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const from = layoutNodeMap.get(edge.fromId);
                const to = layoutNodeMap.get(edge.toId);
                if (!from || !to) return null;
                return <Edge key={`${edge.fromId}->${edge.toId}`} from={from} to={to} />;
              })}

              {layoutNodes.map((node) => (
                <NodeRect
                  key={node.id}
                  node={node}
                  isCritical={criticalIds.has(node.id)}
                  isMain={node.id === 'main'}
                  onClick={() => handleNodeClick(node)}
                />
              ))}
            </svg>
          </div>

          {/* Detail table */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Branch</th>
                  <th className="px-4 py-3">Stage</th>
                  <th className="px-4 py-3">Parents</th>
                  <th className="px-4 py-3">PR</th>
                  {repos.length > 1 && <th className="px-4 py-3">Repo</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {branchNodes.map((node) => (
                  <tr
                    key={node.id}
                    className={[
                      'transition-colors',
                      node.stageId ? 'cursor-pointer hover:bg-slate-50' : '',
                      criticalIds.has(node.id) ? 'bg-orange-50/50' : '',
                    ].join(' ')}
                    onClick={node.stageId ? () => handleNodeClick(node) : undefined}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-800">{node.id}</td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {node.stageTitle ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                      {node.parentBranches.filter((p) => p !== 'main').join(', ') || (
                        <span className="text-slate-300">main</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {node.prUrl ? (
                        <a
                          href={node.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          #{node.prNumber}
                          <ExternalLink size={11} />
                        </a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    {repos.length > 1 && (
                      <td className="px-4 py-2.5 text-xs text-slate-500">{node.repo ?? '—'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
