import { useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export interface GrepMatch {
  lineNumber: number | null;
  text: string;
}

export interface GrepFileGroup {
  filePath: string;
  matches: GrepMatch[];
}

/**
 * Parse a single grep output line in `file:line:content` or `file:content` format.
 * Lines that don't contain a colon are treated as plain text (no file grouping).
 * Returns null for lines that cannot be parsed into a file group.
 */
export function parseGrepLine(line: string): { filePath: string; lineNumber: number | null; text: string } | null {
  if (!line) return null;

  // Try file:linenum:content format (ripgrep default with -n)
  const withLineNum = line.match(/^([^:]+):(\d+):(.*)$/);
  if (withLineNum) {
    return {
      filePath: withLineNum[1],
      lineNumber: parseInt(withLineNum[2], 10),
      text: withLineNum[3],
    };
  }

  // Try file:content format (no line numbers)
  const withoutLineNum = line.match(/^([^:]+):(.+)$/);
  if (withoutLineNum) {
    return {
      filePath: withoutLineNum[1],
      lineNumber: null,
      text: withoutLineNum[2],
    };
  }

  return null;
}

/**
 * Group grep output lines into per-file match groups.
 * Lines that can't be attributed to a file are collected under an empty-string key.
 */
export function groupGrepMatches(lines: string[]): GrepFileGroup[] {
  const map = new Map<string, GrepMatch[]>();
  const order: string[] = [];

  for (const line of lines) {
    const parsed = parseGrepLine(line);
    if (parsed) {
      if (!map.has(parsed.filePath)) {
        map.set(parsed.filePath, []);
        order.push(parsed.filePath);
      }
      map.get(parsed.filePath)!.push({ lineNumber: parsed.lineNumber, text: parsed.text });
    } else {
      // Unattributed line — group under empty string
      if (!map.has('')) {
        map.set('', []);
        order.push('');
      }
      map.get('')!.push({ lineNumber: null, text: line });
    }
  }

  return order.map((filePath) => ({ filePath, matches: map.get(filePath)! }));
}

/**
 * Split text around occurrences of `term` (case-insensitive) for highlighting.
 * Returns an array of { text, highlight } segments.
 */
export function splitForHighlight(text: string, term: string): Array<{ text: string; highlight: boolean }> {
  if (!term) return [{ text, highlight: false }];

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part) => ({
    text: part,
    highlight: regex.test(part),
  }));
}

function HighlightedText({ text, term }: { text: string; term: string }) {
  const parts = splitForHighlight(text, term);
  return (
    <>
      {parts.map((part, i) =>
        part.highlight ? (
          <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5 font-semibold">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function FileGroup({ group, pattern }: { group: GrepFileGroup; pattern: string }) {
  const [open, setOpen] = useState(true);
  const fileName = group.filePath
    ? group.filePath.split('/').pop() || group.filePath
    : '(unattributed)';
  const dirPath = group.filePath.includes('/')
    ? group.filePath.slice(0, group.filePath.lastIndexOf('/') + 1)
    : '';

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-left transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
        )}
        <span className="text-xs font-mono">
          {dirPath && <span className="text-slate-400">{dirPath}</span>}
          <span className="text-slate-700 font-semibold">{fileName}</span>
        </span>
        <span className="ml-auto text-xs text-slate-400 flex-shrink-0">
          {group.matches.length} {group.matches.length === 1 ? 'match' : 'matches'}
        </span>
      </button>
      {open && (
        <div className="divide-y divide-slate-100">
          {group.matches.map((match, i) => (
            <div key={i} className="flex items-start gap-0 text-xs font-mono px-0">
              {match.lineNumber !== null && (
                <span className="w-10 flex-shrink-0 text-right text-slate-400 select-none px-2 py-1 bg-slate-50 border-r border-slate-200">
                  {match.lineNumber}
                </span>
              )}
              <span className="px-3 py-1 text-slate-700 break-all">
                <HighlightedText text={match.text} term={pattern} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GrepRenderer({ execution }: Props) {
  const { input } = execution;
  const pattern = input.pattern as string | undefined;
  const glob = input.glob as string | undefined;

  const output = extractResultContent(execution.result);
  const lines = output ? output.split('\n').filter(Boolean) : [];
  const groups = groupGrepMatches(lines);
  const totalMatches = groups.reduce((sum, g) => sum + g.matches.length, 0);
  const fileCount = groups.filter((g) => g.filePath !== '').length;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Search className="w-4 h-4 flex-shrink-0" />
        {pattern && (
          <code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded">"{pattern}"</code>
        )}
        {glob && <span className="text-xs text-slate-400">in {glob}</span>}
        {lines.length === 0 ? (
          <span className="text-xs text-slate-400">No matches found</span>
        ) : (
          <span className="text-xs text-slate-400">
            {totalMatches} {totalMatches === 1 ? 'match' : 'matches'}
            {fileCount > 0 && ` in ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
          </span>
        )}
      </div>
      {groups.length > 0 && (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {groups.map((group, i) => (
            <FileGroup key={i} group={group} pattern={pattern ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}
