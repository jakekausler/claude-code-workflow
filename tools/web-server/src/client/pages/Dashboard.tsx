import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useStats, useBoard, useStages } from '../api/hooks.js';
import { AlertTriangle, Activity, Layers, GitBranch } from 'lucide-react';
import { slugToTitle } from '../utils/formatters.js';
import { useSSE } from '../api/use-sse.js';

export function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useStats();
  const { data: board, error: boardError } = useBoard({ column: 'backlog' });
  const { data: stages, error: stagesError } = useStages();

  const queryClient = useQueryClient();

  const handleSSE = useCallback(
    (_channel: string, _data: unknown) => {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['stages'] });
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
    [queryClient],
  );

  useSSE(['board-update', 'stage-transition'], handleSSE);

  const blockedCount = board?.columns['backlog']?.length ?? 0;

  const recentStages = (stages ?? []).slice(0, 20);

  const totalStages = stats?.total_stages ?? 0;
  const byColumn = stats?.by_column ?? {};
  const doneCount = byColumn['done'] ?? 0;
  const completionPct = totalStages > 0 ? Math.round((doneCount / totalStages) * 100) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>

      {(statsError || boardError || stagesError) && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2">
          <span className="text-sm text-red-700">Some data failed to load. Showing available information.</span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Stages" value={statsLoading ? '...' : String(totalStages)} />
        <StatCard label="Total Tickets" value={statsLoading ? '...' : String(stats?.total_tickets ?? 0)} />
        <StatCard label="Completion" value={statsLoading ? '...' : `${completionPct}%`} />
        <StatCard label="Active Sessions" value="—" subtitle="Available in 9E" />
      </div>

      {/* Blocked Alert */}
      {blockedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle size={18} className="text-amber-600" />
          <span className="text-sm font-medium text-amber-800">
            {blockedCount} stage{blockedCount !== 1 ? 's' : ''} in backlog
          </span>
        </div>
      )}

      {/* Column Breakdown */}
      {stats && Object.keys(byColumn).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Stages by Column</h2>
          <div className="space-y-2">
            {Object.entries(byColumn).map(([slug, count]) => (
              <div key={slug} className="flex items-center gap-3">
                <span className="w-40 text-xs text-slate-600 truncate">{slugToTitle(slug)}</span>
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: totalStages > 0 ? `${(count / totalStages) * 100}%` : '0%' }}
                  />
                </div>
                <span className="w-8 text-right text-xs text-slate-500">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700">Recent Activity</h2>
        </div>
        {recentStages.length === 0 ? (
          <p className="text-sm text-slate-400">No recent activity.</p>
        ) : (
          <div className="space-y-2">
            {recentStages.map((stage) => (
              <div key={stage.id} className="flex items-center gap-3 text-xs">
                <span className="w-32 shrink-0 text-slate-400 truncate">{stage.id}</span>
                <span className="truncate text-slate-700">{stage.title}</span>
                <span className="shrink-0 text-slate-400">{stage.ticket_id}</span>
                <span className="ml-auto shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                  {slugToTitle(stage.kanban_column)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <QuickLink to="/board" icon={Layers} label="Board" description="View all stages in kanban columns" />
        <QuickLink to="/graph" icon={GitBranch} label="Dependency Graph" description="Visualize dependencies across stages" />
      </div>
    </div>
  );
}

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
  description,
}: {
  to: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md"
    >
      <Icon size={20} />
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
    </Link>
  );
}
