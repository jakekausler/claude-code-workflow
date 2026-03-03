import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCurrentUser } from '../api/hooks.js';
import { can } from '../utils/permissions.js';

const STORAGE_KEY = 'ccw-settings';

// ─── Jira filter types (mirrored from server) ─────────────────────────────────

interface JiraFilterConfig {
  labels: string[];
  statuses: string[];
  assignee: string | null;
  custom_fields: Record<string, unknown>;
  logic: 'AND' | 'OR';
  jql_override: string | null;
}

const DEFAULT_JIRA_FILTER_CONFIG: JiraFilterConfig = {
  labels: ['claude-workflow'],
  statuses: ['To Do', 'Ready for Dev'],
  assignee: null,
  custom_fields: {},
  logic: 'AND',
  jql_override: null,
};

// ─── App settings ─────────────────────────────────────────────────────────────

interface JiraSettings {
  instanceUrl: string;
  apiToken: string;
  defaultProjectKey: string;
}

interface GitHubSettings {
  personalAccessToken: string;
  defaultOwner: string;
  repository: string;
}

interface GitLabSettings {
  instanceUrl: string;
  accessToken: string;
  defaultGroup: string;
}

interface SlackSettings {
  webhookUrl: string;
  defaultChannel: string;
  notifyOnSessionStart: boolean;
  notifyOnSessionEnd: boolean;
  notifyOnStageTransition: boolean;
  notifyOnError: boolean;
}

interface PreferencesSettings {
  theme: 'light' | 'dark' | 'system';
  defaultBoardView: 'epic' | 'ticket' | 'stage';
  displayDensity: 'compact' | 'comfortable';
}

interface AppSettings {
  jira: JiraSettings;
  github: GitHubSettings;
  gitlab: GitLabSettings;
  slack: SlackSettings;
  preferences: PreferencesSettings;
}

const defaultSettings: AppSettings = {
  jira: {
    instanceUrl: '',
    apiToken: '',
    defaultProjectKey: '',
  },
  github: {
    personalAccessToken: '',
    defaultOwner: '',
    repository: '',
  },
  gitlab: {
    instanceUrl: 'gitlab.com',
    accessToken: '',
    defaultGroup: '',
  },
  slack: {
    webhookUrl: '',
    defaultChannel: '',
    notifyOnSessionStart: true,
    notifyOnSessionEnd: true,
    notifyOnStageTransition: false,
    notifyOnError: true,
  },
  preferences: {
    theme: 'system',
    defaultBoardView: 'stage',
    displayDensity: 'comfortable',
  },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      jira: { ...defaultSettings.jira, ...parsed.jira },
      github: { ...defaultSettings.github, ...parsed.github },
      gitlab: { ...defaultSettings.gitlab, ...parsed.gitlab },
      slack: { ...defaultSettings.slack, ...parsed.slack },
      preferences: { ...defaultSettings.preferences, ...parsed.preferences },
    };
  } catch {
    return defaultSettings;
  }
}

function saveSection<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  const current = loadSettings();
  const updated = { ...current, [key]: value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-800">{title}</h2>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-4 sm:items-center mb-4">
      <label className="text-sm font-medium text-slate-600">{label}</label>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

function SelectInput<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      {label}
    </label>
  );
}

function ActionButtons({
  onSave,
  onTest,
  toast,
}: {
  onSave: () => void;
  onTest: () => void;
  toast: string | null;
}) {
  return (
    <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
      <button
        onClick={onSave}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Save
      </button>
      <button
        onClick={onTest}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        Test Connection
      </button>
      {toast && (
        <span className="text-sm text-slate-500">{toast}</span>
      )}
    </div>
  );
}

// ─── Jira Filter Form ─────────────────────────────────────────────────────────

/** Parse a comma-separated string into a trimmed array of non-empty strings. */
function parseList(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function JiraFilterForm({
  initial,
  onSaved,
}: {
  initial: JiraFilterConfig;
  onSaved?: () => void;
}) {
  const [labels, setLabels] = useState(initial.labels.join(', '));
  const [statuses, setStatuses] = useState(initial.statuses.join(', '));
  const [assignee, setAssignee] = useState(initial.assignee ?? '');
  const [logic, setLogic] = useState<'AND' | 'OR'>(initial.logic);
  const [jqlOpen, setJqlOpen] = useState(!!initial.jql_override);
  const [jqlOverride, setJqlOverride] = useState(initial.jql_override ?? '');
  const [toast, setToast] = useState<string | null>(null);

  async function handleSave() {
    const config: JiraFilterConfig = {
      labels: parseList(labels),
      statuses: parseList(statuses),
      assignee: assignee.trim() || null,
      custom_fields: initial.custom_fields,
      logic,
      jql_override: jqlOverride.trim() || null,
    };
    try {
      const res = await fetch('/api/settings/jira/filters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setToast(`Error: ${data.error ?? res.status}`);
      } else {
        setToast('Saved.');
        onSaved?.();
      }
    } catch (err) {
      setToast(`Error: ${String(err)}`);
    }
    setTimeout(() => setToast(null), 2500);
  }

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-slate-700">Auto-pull Filters</h3>
      <p className="text-xs text-slate-500">
        Controls which Jira tickets are fetched on the Import Issues page. Combine dimensions with AND / OR, or override with raw JQL.
      </p>

      <FieldRow label="Labels">
        <TextInput
          value={labels}
          onChange={setLabels}
          placeholder="claude-workflow, my-label"
        />
        <p className="mt-1 text-xs text-slate-400">Comma-separated label names</p>
      </FieldRow>

      <FieldRow label="Statuses">
        <TextInput
          value={statuses}
          onChange={setStatuses}
          placeholder="To Do, Ready for Dev"
        />
        <p className="mt-1 text-xs text-slate-400">Comma-separated status names</p>
      </FieldRow>

      <FieldRow label="Assignee">
        <TextInput
          value={assignee}
          onChange={setAssignee}
          placeholder="username (leave blank for any)"
        />
      </FieldRow>

      <FieldRow label="Combine with">
        <div className="flex gap-3">
          {(['AND', 'OR'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => setLogic(opt)}
              className={`rounded-md border px-4 py-1.5 text-sm font-medium transition-colors ${
                logic === opt
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </FieldRow>

      {/* Collapsible JQL override */}
      <div>
        <button
          onClick={() => setJqlOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800"
        >
          {jqlOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          JQL Override {jqlOpen ? '(active)' : '(optional)'}
        </button>
        {jqlOpen && (
          <div className="mt-2">
            <textarea
              value={jqlOverride}
              onChange={(e) => setJqlOverride(e.target.value)}
              placeholder="project = MYPROJ AND sprint in openSprints()"
              rows={3}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-400">
              When set, this raw JQL overrides all dimension filters above.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Save Filters
        </button>
        {toast && <span className="text-sm text-slate-500">{toast}</span>}
      </div>
    </div>
  );
}

// ─── Section components ───────────────────────────────────────────────────────

function JiraSection({ initial }: { initial: JiraSettings }) {
  const [form, setForm] = useState<JiraSettings>(initial);
  const [toast, setToast] = useState<string | null>(null);
  const [filterConfig, setFilterConfig] = useState<JiraFilterConfig>(DEFAULT_JIRA_FILTER_CONFIG);

  useEffect(() => {
    fetch('/api/settings/jira/filters')
      .then((r) => r.json())
      .then((data) => setFilterConfig({ ...DEFAULT_JIRA_FILTER_CONFIG, ...(data as Partial<JiraFilterConfig>) }))
      .catch(() => { /* keep default */ });
  }, []);

  function field<K extends keyof JiraSettings>(key: K) {
    return (value: JiraSettings[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSection('jira', form);
    setToast('Saved.');
    setTimeout(() => setToast(null), 2000);
  }

  function handleTest() {
    setToast('Connection test not yet implemented.');
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <SectionCard title="Jira">
      <FieldRow label="Instance URL">
        <TextInput value={form.instanceUrl} onChange={field('instanceUrl')} placeholder="https://yourorg.atlassian.net" />
      </FieldRow>
      <FieldRow label="API Token">
        <TextInput value={form.apiToken} onChange={field('apiToken')} type="password" placeholder="Jira API token" />
      </FieldRow>
      <FieldRow label="Default Project Key">
        <TextInput value={form.defaultProjectKey} onChange={field('defaultProjectKey')} placeholder="MYPROJ" />
      </FieldRow>
      <ActionButtons onSave={handleSave} onTest={handleTest} toast={toast} />
      <JiraFilterForm initial={filterConfig} />
    </SectionCard>
  );
}

function GitHubSection({ initial }: { initial: GitHubSettings }) {
  const [form, setForm] = useState<GitHubSettings>(initial);
  const [toast, setToast] = useState<string | null>(null);

  function field<K extends keyof GitHubSettings>(key: K) {
    return (value: GitHubSettings[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSection('github', form);
    setToast('Saved.');
    setTimeout(() => setToast(null), 2000);
  }

  function handleTest() {
    setToast('Connection test not yet implemented.');
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <SectionCard title="GitHub">
      <FieldRow label="Personal Access Token">
        <TextInput value={form.personalAccessToken} onChange={field('personalAccessToken')} type="password" placeholder="ghp_..." />
      </FieldRow>
      <FieldRow label="Default Owner / Org">
        <TextInput value={form.defaultOwner} onChange={field('defaultOwner')} placeholder="myorg" />
      </FieldRow>
      <FieldRow label="Repository">
        <TextInput value={form.repository} onChange={field('repository')} placeholder="my-repo" />
      </FieldRow>
      <ActionButtons onSave={handleSave} onTest={handleTest} toast={toast} />
    </SectionCard>
  );
}

function GitLabSection({ initial }: { initial: GitLabSettings }) {
  const [form, setForm] = useState<GitLabSettings>(initial);
  const [toast, setToast] = useState<string | null>(null);

  function field<K extends keyof GitLabSettings>(key: K) {
    return (value: GitLabSettings[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSection('gitlab', form);
    setToast('Saved.');
    setTimeout(() => setToast(null), 2000);
  }

  function handleTest() {
    setToast('Connection test not yet implemented.');
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <SectionCard title="GitLab">
      <FieldRow label="Instance URL">
        <TextInput value={form.instanceUrl} onChange={field('instanceUrl')} placeholder="gitlab.com" />
      </FieldRow>
      <FieldRow label="Access Token">
        <TextInput value={form.accessToken} onChange={field('accessToken')} type="password" placeholder="glpat-..." />
      </FieldRow>
      <FieldRow label="Default Group / Project">
        <TextInput value={form.defaultGroup} onChange={field('defaultGroup')} placeholder="mygroup/myproject" />
      </FieldRow>
      <ActionButtons onSave={handleSave} onTest={handleTest} toast={toast} />
    </SectionCard>
  );
}

function SlackSection({ initial }: { initial: SlackSettings }) {
  const [form, setForm] = useState<SlackSettings>(initial);
  const [toast, setToast] = useState<string | null>(null);

  function stringField<K extends keyof SlackSettings>(key: K) {
    return (value: string) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function boolField<K extends keyof SlackSettings>(key: K) {
    return (value: boolean) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSection('slack', form);
    setToast('Saved.');
    setTimeout(() => setToast(null), 2000);
  }

  function handleTest() {
    setToast('Connection test not yet implemented.');
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <SectionCard title="Slack">
      <FieldRow label="Webhook URL">
        <TextInput value={form.webhookUrl} onChange={stringField('webhookUrl')} placeholder="https://hooks.slack.com/services/..." />
      </FieldRow>
      <FieldRow label="Default Channel">
        <TextInput value={form.defaultChannel} onChange={stringField('defaultChannel')} placeholder="#general" />
      </FieldRow>
      <FieldRow label="Notifications">
        <div className="space-y-2">
          <CheckboxField
            label="Session started"
            checked={form.notifyOnSessionStart}
            onChange={boolField('notifyOnSessionStart')}
          />
          <CheckboxField
            label="Session ended"
            checked={form.notifyOnSessionEnd}
            onChange={boolField('notifyOnSessionEnd')}
          />
          <CheckboxField
            label="Stage transition"
            checked={form.notifyOnStageTransition}
            onChange={boolField('notifyOnStageTransition')}
          />
          <CheckboxField
            label="Errors"
            checked={form.notifyOnError}
            onChange={boolField('notifyOnError')}
          />
        </div>
      </FieldRow>
      <ActionButtons onSave={handleSave} onTest={handleTest} toast={toast} />
    </SectionCard>
  );
}

function PreferencesSection({ initial }: { initial: PreferencesSettings }) {
  const [form, setForm] = useState<PreferencesSettings>(initial);
  const [toast, setToast] = useState<string | null>(null);

  function field<K extends keyof PreferencesSettings>(key: K) {
    return (value: PreferencesSettings[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    saveSection('preferences', form);
    setToast('Saved.');
    setTimeout(() => setToast(null), 2000);
  }

  return (
    <SectionCard title="Preferences">
      <FieldRow label="Theme">
        <SelectInput<'light' | 'dark' | 'system'>
          value={form.theme}
          onChange={field('theme')}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </FieldRow>
      <FieldRow label="Default Board View">
        <SelectInput<'epic' | 'ticket' | 'stage'>
          value={form.defaultBoardView}
          onChange={field('defaultBoardView')}
          options={[
            { value: 'epic', label: 'Epic pipeline' },
            { value: 'ticket', label: 'Ticket pipeline' },
            { value: 'stage', label: 'Stage pipeline' },
          ]}
        />
      </FieldRow>
      <FieldRow label="Display Density">
        <SelectInput<'compact' | 'comfortable'>
          value={form.displayDensity}
          onChange={field('displayDensity')}
          options={[
            { value: 'compact', label: 'Compact' },
            { value: 'comfortable', label: 'Comfortable' },
          ]}
        />
      </FieldRow>
      <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
        <button
          onClick={handleSave}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Save
        </button>
        {toast && <span className="text-sm text-slate-500">{toast}</span>}
      </div>
    </SectionCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function Settings() {
  const { data: me } = useCurrentUser();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  const canAdmin = can(me, 'settings:serviceConnections');
  const canPreferences = me === undefined || can(me, 'settings:userPreferences');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
      {canAdmin && <JiraSection initial={settings.jira} />}
      {canAdmin && <GitHubSection initial={settings.github} />}
      {canAdmin && <GitLabSection initial={settings.gitlab} />}
      {canAdmin && <SlackSection initial={settings.slack} />}
      {canPreferences && <PreferencesSection initial={settings.preferences} />}
      {!canAdmin && !canPreferences && me !== undefined && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center">
          <p className="text-sm text-slate-500">You don&apos;t have permission to view settings.</p>
        </div>
      )}
    </div>
  );
}
