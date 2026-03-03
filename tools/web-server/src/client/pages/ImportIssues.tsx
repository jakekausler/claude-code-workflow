import { useState } from 'react';
import { Github, GitMerge, Search, Check, AlertCircle, Loader2, Download, Layers } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client.js';

const STORAGE_KEY = 'ccw-settings';

interface Settings {
  github: { personalAccessToken: string; defaultOwner: string; repository: string };
  gitlab: { instanceUrl: string; accessToken: string; defaultGroup: string };
  jira: { instanceUrl: string; projectKey: string; email: string; apiToken: string };
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Settings;
  } catch { /* ignore */ }
  return {
    github: { personalAccessToken: '', defaultOwner: '', repository: '' },
    gitlab: { instanceUrl: 'gitlab.com', accessToken: '', defaultGroup: '' },
    jira: { instanceUrl: '', projectKey: '', email: '', apiToken: '' },
  };
}

interface RemoteIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
  url: string;
}

interface EpicOption { id: string; title: string }

export function ImportIssues() {
  const settings = loadSettings();

  const [provider, setProvider] = useState<'github' | 'gitlab' | 'jira'>('github');

  // GitHub fields
  const [ghOwner, setGhOwner] = useState(settings.github.defaultOwner);
  const [ghRepo, setGhRepo] = useState(settings.github.repository);
  const [ghToken, setGhToken] = useState(settings.github.personalAccessToken);

  // GitLab fields
  const [glProject, setGlProject] = useState('');
  const [glInstance, setGlInstance] = useState(
    settings.gitlab.instanceUrl ? `https://${settings.gitlab.instanceUrl}` : 'https://gitlab.com',
  );
  const [glToken, setGlToken] = useState(settings.gitlab.accessToken);

  // Jira fields
  const [jiraInstance, setJiraInstance] = useState(settings.jira.instanceUrl || '');
  const [jiraProject, setJiraProject] = useState(settings.jira.projectKey || '');
  const [jiraEmail, setJiraEmail] = useState(settings.jira.email || '');
  const [jiraToken, setJiraToken] = useState(settings.jira.apiToken || '');

  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [issues, setIssues] = useState<RemoteIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [epicId, setEpicId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const epicsQuery = useQuery({
    queryKey: ['epics-for-import'],
    queryFn: () => apiFetch<EpicOption[]>('/api/epics'),
  });

  const epics: EpicOption[] = (epicsQuery.data ?? []).map((e: EpicOption) => ({
    id: e.id,
    title: e.title,
  }));

  const handleFetch = async () => {
    setFetching(true);
    setFetchError(null);
    setIssues([]);
    setSelected(new Set());
    setImportResult(null);

    try {
      let url: string;
      if (provider === 'github') {
        const params = new URLSearchParams({ owner: ghOwner, repo: ghRepo });
        if (ghToken) params.set('token', ghToken);
        url = `/api/import/github/issues?${params.toString()}`;
      } else if (provider === 'gitlab') {
        const params = new URLSearchParams({ projectId: glProject, instanceUrl: glInstance });
        if (glToken) params.set('token', glToken);
        url = `/api/import/gitlab/issues?${params.toString()}`;
      } else {
        const params = new URLSearchParams({
          instanceUrl: jiraInstance,
          projectKey: jiraProject,
          email: jiraEmail,
          apiToken: jiraToken,
        });
        url = `/api/import/jira/issues?${params.toString()}`;
      }
      const res = await fetch(url);
      const data = await res.json() as { issues?: RemoteIssue[]; error?: string };
      if (!res.ok || data.error) {
        setFetchError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setIssues(data.issues ?? []);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setFetching(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === issues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((i) => i.id)));
    }
  };

  const toggleIssue = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    const toImport = issues.filter((i) => selected.has(i.id));
    if (toImport.length === 0) return;

    setImporting(true);
    setImportResult(null);

    try {
      const res = await fetch('/api/import/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          issues: toImport,
          epicId: epicId || undefined,
        }),
      });
      const data = await res.json() as { imported: number; skipped: number };
      setImportResult(data);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Issues</h1>
        <p className="mt-1 text-sm text-slate-500">
          Import GitHub, GitLab, or Jira issues as tickets. Duplicate issues (same source ID) are skipped.
        </p>
      </div>

      {/* Provider selector */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Provider</h2>
        <div className="flex gap-3">
          {(['github', 'gitlab', 'jira'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                provider === p
                  ? 'border-slate-800 bg-slate-800 text-white'
                  : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {p === 'github' ? <Github size={16} /> : p === 'gitlab' ? <GitMerge size={16} /> : <Layers size={16} />}
              {p === 'github' ? 'GitHub' : p === 'gitlab' ? 'GitLab' : 'Jira'}
            </button>
          ))}
        </div>

        {/* GitHub fields */}
        {provider === 'github' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Owner</label>
              <input
                type="text"
                value={ghOwner}
                onChange={(e) => setGhOwner(e.target.value)}
                placeholder="e.g. octocat"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Repository</label>
              <input
                type="text"
                value={ghRepo}
                onChange={(e) => setGhRepo(e.target.value)}
                placeholder="e.g. my-project"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Personal Access Token (optional)</label>
              <input
                type="password"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                placeholder="ghp_..."
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* GitLab fields */}
        {provider === 'gitlab' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project ID or path</label>
              <input
                type="text"
                value={glProject}
                onChange={(e) => setGlProject(e.target.value)}
                placeholder="e.g. 12345 or group/project"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Instance URL</label>
              <input
                type="text"
                value={glInstance}
                onChange={(e) => setGlInstance(e.target.value)}
                placeholder="https://gitlab.com"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Access Token (optional)</label>
              <input
                type="password"
                value={glToken}
                onChange={(e) => setGlToken(e.target.value)}
                placeholder="glpat-..."
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Jira fields */}
        {provider === 'jira' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Instance URL</label>
              <input
                type="text"
                value={jiraInstance}
                onChange={(e) => setJiraInstance(e.target.value)}
                placeholder="https://yourcompany.atlassian.net"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Project Key</label>
              <input
                type="text"
                value={jiraProject}
                onChange={(e) => setJiraProject(e.target.value)}
                placeholder="e.g. PROJ"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input
                type="text"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">API Token</label>
              <input
                type="password"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                placeholder="Your Jira API token"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
          </div>
        )}

        <button
          onClick={handleFetch}
          disabled={fetching}
          className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {fetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          Fetch Issues
        </button>

        {fetchError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertCircle size={16} />
            {fetchError}
          </div>
        )}
      </div>

      {/* Issue list */}
      {issues.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={selected.size === issues.length}
                onChange={toggleAll}
                className="rounded"
              />
              <span className="text-sm font-medium text-slate-700">
                {issues.length} issue{issues.length !== 1 ? 's' : ''} found
              </span>
            </div>
            <span className="text-xs text-slate-500">{selected.size} selected</span>
          </div>

          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {issues.map((issue) => (
              <label key={issue.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.has(issue.id)}
                  onChange={() => toggleIssue(issue.id)}
                  className="mt-0.5 rounded"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{issue.title}</span>
                    <span className="text-xs text-slate-400 flex-shrink-0">#{issue.number}</span>
                  </div>
                  {issue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {issue.labels.map((l) => (
                        <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{l}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`text-xs flex-shrink-0 rounded-full px-2 py-0.5 ${
                  issue.state === 'open' || issue.state === 'opened'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {issue.state}
                </span>
              </label>
            ))}
          </div>

          {/* Epic association */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Associate with Epic (optional)</label>
              <select
                value={epicId}
                onChange={(e) => setEpicId(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm bg-white focus:border-slate-400 focus:outline-none"
              >
                <option value="">No epic</option>
                {epics.map((e) => (
                  <option key={e.id} value={e.id}>{e.title} ({e.id})</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Import {selected.size > 0 ? `${selected.size} issue${selected.size !== 1 ? 's' : ''}` : 'selected issues'}
            </button>

            {importResult && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                <Check size={16} />
                Imported {importResult.imported} issue{importResult.imported !== 1 ? 's' : ''}.
                {importResult.skipped > 0 && ` ${importResult.skipped} skipped (already imported).`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Periodic sync stub */}
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
        <h2 className="text-sm font-semibold text-slate-600">Periodic Sync</h2>
        <p className="mt-1 text-xs text-slate-500">
          Automatic periodic sync configuration will be available in a future release.
          Configure sync criteria (labels, milestones, assignees) and sync interval in Settings.
        </p>
      </div>
    </div>
  );
}
