import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Layers, FileText, GitBranch, Clock, ChevronRight } from 'lucide-react';
import { useSearchStore } from '../../store/search-store.js';
import { useDrawerStore } from '../../store/drawer-store.js';

interface SearchResult {
  type: 'epic' | 'ticket' | 'stage';
  id: string;
  title: string;
  status: string;
  parentContext: string;
}

const RECENT_KEY = 'ccw-recent-searches';
const MAX_RECENT = 5;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(searches: string[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(searches.slice(0, MAX_RECENT)));
}

const TYPE_ICONS = {
  epic: Layers,
  ticket: FileText,
  stage: GitBranch,
} as const;

const TYPE_LABELS = {
  epic: 'Epic',
  ticket: 'Ticket',
  stage: 'Stage',
} as const;

export function GlobalSearch() {
  const { isOpen, close } = useSearchStore();
  const navigate = useNavigate();
  const openDrawer = useDrawerStore((s) => s.open);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'epic' | 'ticket' | 'stage' | ''>('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) close();
        else useSearchStore.getState().open();
      }
      if (e.key === 'Escape' && isOpen) close();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  const doSearch = useCallback(async (q: string, type: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q });
      if (type) params.set('type', type);
      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        const data = await res.json() as { results: SearchResult[] };
        setResults(data.results);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val, typeFilter), 300);
  };

  const handleTypeFilter = (t: 'epic' | 'ticket' | 'stage' | '') => {
    setTypeFilter(t);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query, t), 0);
  };

  const handleSelect = (result: SearchResult) => {
    // Save to recent
    const updated = [result.title, ...recent.filter((r) => r !== result.title)].slice(0, MAX_RECENT);
    setRecent(updated);
    saveRecent(updated);
    close();

    // Navigate or open drawer based on type
    if (result.type === 'epic') {
      navigate(`/epics/${result.id}`);
    } else if (result.type === 'ticket') {
      openDrawer({ type: 'ticket', id: result.id });
    } else if (result.type === 'stage') {
      openDrawer({ type: 'stage', id: result.id });
    }
  };

  const handleRecentClick = (term: string) => {
    setQuery(term);
    doSearch(term, typeFilter);
  };

  if (!isOpen) return null;

  // Group results by type
  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) {
    (grouped[r.type] ??= []).push(r);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={close}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl ring-1 ring-slate-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search size={18} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search epics, tickets, stages…"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 outline-none bg-transparent"
          />
          {loading && (
            <span className="text-xs text-slate-400 animate-pulse">Searching…</span>
          )}
          <button
            onClick={close}
            className="rounded p-1 text-slate-400 hover:text-slate-600"
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100">
          {(['', 'epic', 'ticket', 'stage'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTypeFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                typeFilter === t
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {t === '' ? 'All' : TYPE_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {!query && recent.length > 0 && (
            <div className="px-4 py-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">Recent</p>
              {recent.map((r) => (
                <button
                  key={r}
                  onClick={() => handleRecentClick(r)}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 text-left"
                >
                  <Clock size={14} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700 truncate">{r}</span>
                </button>
              ))}
            </div>
          )}

          {query && results.length === 0 && !loading && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No results for &quot;{query}&quot;
            </div>
          )}

          {Object.entries(grouped).map(([type, items]) => (
            <div key={type} className="px-4 py-2">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
                {TYPE_LABELS[type as keyof typeof TYPE_LABELS]}s
              </p>
              {items.map((result) => {
                const Icon = TYPE_ICONS[result.type];
                return (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 text-left"
                  >
                    <Icon size={14} className="text-slate-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-slate-800 truncate block">{result.title}</span>
                      {result.parentContext && (
                        <span className="text-xs text-slate-400 truncate block">{result.parentContext}</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 flex-shrink-0">{result.status}</span>
                    <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400">
            <kbd className="bg-slate-100 rounded px-1 py-0.5">⌘K</kbd> to toggle
          </span>
          <span className="text-xs text-slate-400">
            <kbd className="bg-slate-100 rounded px-1 py-0.5">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
