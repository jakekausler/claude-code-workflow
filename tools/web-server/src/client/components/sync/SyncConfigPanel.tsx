import { useState } from 'react';
import { RefreshCw, Plus, Trash2, Play, AlertCircle, Check, Loader2 } from 'lucide-react';
import {
  useSyncConfigs,
  useSyncStatuses,
  useCreateSyncConfig,
  useDeleteSyncConfig,
  useTriggerSync,
  type SyncConfig,
  type SyncStatus,
} from '../../hooks/useSyncConfigs.js';
import { useRepos } from '../../api/hooks.js';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusBadge({ status }: { status: SyncStatus | undefined }) {
  if (!status) {
    return <span className="text-xs text-gray-400">No sync yet</span>;
  }
  if (status.last_error) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-400">
      <Check className="w-3 h-3" />
      {status.items_synced} synced {formatRelativeTime(status.last_sync_at)}
    </span>
  );
}

function CreateConfigForm({ onClose }: { onClose: () => void }) {
  const { data: reposData } = useRepos();
  const createConfig = useCreateSyncConfig();

  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [repoId, setRepoId] = useState<number>(0);
  const [remoteOwner, setRemoteOwner] = useState('');
  const [remoteRepo, setRemoteRepo] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('https://gitlab.com');
  const [token, setToken] = useState('');
  const [intervalHours, setIntervalHours] = useState(1);

  const repos = reposData ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetRepoId = repoId || (repos.length > 0 ? repos[0].id : 0);
    if (!targetRepoId) return;

    createConfig.mutate(
      {
        repo_id: targetRepoId,
        provider,
        remote_owner: remoteOwner || null,
        remote_repo: remoteRepo || null,
        instance_url: provider === 'gitlab' ? instanceUrl : null,
        token: token || null,
        labels: [],
        milestones: [],
        assignees: [],
        enabled: true,
        interval_ms: intervalHours * 3600000,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-gray-800 rounded-lg border border-gray-700">
      <h3 className="text-sm font-medium text-gray-200">New Sync Configuration</h3>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-400">Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as 'github' | 'gitlab')}
            className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
          >
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">Local Repo</span>
          <select
            value={repoId}
            onChange={(e) => setRepoId(Number(e.target.value))}
            className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
          >
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-gray-400">Owner / Group</span>
          <input
            type="text"
            value={remoteOwner}
            onChange={(e) => setRemoteOwner(e.target.value)}
            placeholder="e.g. facebook"
            className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
          />
        </label>

        <label className="block">
          <span className="text-xs text-gray-400">Repository</span>
          <input
            type="text"
            value={remoteRepo}
            onChange={(e) => setRemoteRepo(e.target.value)}
            placeholder="e.g. react"
            className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
          />
        </label>
      </div>

      {provider === 'gitlab' && (
        <label className="block">
          <span className="text-xs text-gray-400">Instance URL</span>
          <input
            type="text"
            value={instanceUrl}
            onChange={(e) => setInstanceUrl(e.target.value)}
            className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
          />
        </label>
      )}

      <label className="block">
        <span className="text-xs text-gray-400">Access Token (optional)</span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Token for private repos"
          className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
        />
      </label>

      <label className="block">
        <span className="text-xs text-gray-400">Sync Interval (hours)</span>
        <input
          type="number"
          min={1}
          value={intervalHours}
          onChange={(e) => setIntervalHours(Number(e.target.value))}
          className="mt-1 block w-full rounded bg-gray-700 border-gray-600 text-sm text-gray-200 p-1.5"
        />
      </label>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={createConfig.isPending}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {createConfig.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
    </form>
  );
}

function ConfigRow({
  config,
  status,
}: {
  config: SyncConfig;
  status: SyncStatus | undefined;
}) {
  const deleteConfig = useDeleteSyncConfig();
  const triggerSync = useTriggerSync();

  return (
    <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
            {config.provider}
          </span>
          <span className="text-sm text-gray-200 truncate">
            {config.remote_owner}/{config.remote_repo}
          </span>
          {!config.enabled && (
            <span className="text-xs text-yellow-500">disabled</span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <StatusBadge status={status} />
          <span className="text-xs text-gray-500">
            every {config.interval_ms / 3600000}h
          </span>
          {status?.next_sync_at && (
            <span className="text-xs text-gray-500">
              next: {formatRelativeTime(status.next_sync_at)}
            </span>
          )}
        </div>
        {status?.last_error && (
          <p className="mt-1 text-xs text-red-400 truncate">{status.last_error}</p>
        )}
      </div>

      <div className="flex items-center gap-1 ml-3">
        <button
          onClick={() => triggerSync.mutate(config.id)}
          disabled={triggerSync.isPending}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400 disabled:opacity-50"
          title="Sync Now"
        >
          {triggerSync.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={() => {
            if (confirm('Delete this sync configuration?')) {
              deleteConfig.mutate(config.id);
            }
          }}
          disabled={deleteConfig.isPending}
          className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400 disabled:opacity-50"
          title="Delete"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function SyncConfigPanel() {
  const { data: configsData, isLoading: configsLoading } = useSyncConfigs();
  const { data: statusesData } = useSyncStatuses();
  const [showForm, setShowForm] = useState(false);

  const configs = configsData?.configs ?? [];
  const statuses = statusesData?.statuses ?? [];

  const statusMap = new Map(statuses.map((s) => [s.config_id, s]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-medium text-gray-200">Issue Sync</h2>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-500"
        >
          <Plus className="w-3 h-3" />
          Add Config
        </button>
      </div>

      {showForm && <CreateConfigForm onClose={() => setShowForm(false)} />}

      {configsLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : configs.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">
          No sync configurations. Click "Add Config" to set up periodic issue import.
        </p>
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <ConfigRow
              key={config.id}
              config={config}
              status={statusMap.get(config.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
