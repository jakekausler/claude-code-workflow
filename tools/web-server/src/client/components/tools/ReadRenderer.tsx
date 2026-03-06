import { extractResultContent } from '../../utils/session-formatters.js';
import { CodeBlockViewer } from './CodeBlockViewer.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

/**
 * Strips line number prefixes from Read tool output.
 * Format: `     1\tcontent` or `     1->content`
 * Returns { content: string, startLine: number }
 */
function stripLineNumberPrefixes(raw: string): { content: string; startLine: number } {
  const lines = raw.split('\n');
  // Match pattern: optional spaces, digits, then tab or -> character
  const prefixPattern = /^\s*(\d+)[\t\u2192]/;

  const firstMatch = prefixPattern.exec(lines[0]);
  const startLine = firstMatch ? parseInt(firstMatch[1], 10) : 1;

  const strippedLines = lines.map((line) => {
    const match = prefixPattern.exec(line);
    return match ? line.slice(match[0].length) : line;
  });

  return { content: strippedLines.join('\n'), startLine };
}

export function ReadRenderer({ execution }: Props) {
  const { input, result } = execution;
  const filePath = (input.file_path as string) ?? 'unknown';
  const offset = input.offset as number | undefined;
  const limit = input.limit as number | undefined;

  const rawContent = extractResultContent(result);
  const { content, startLine: parsedStartLine } = rawContent
    ? stripLineNumberPrefixes(rawContent.replace(/\n$/, ''))
    : { content: '', startLine: 1 };

  const startLine = offset ?? parsedStartLine;
  const lines = content ? content.split('\n') : [];
  const endLine = limit ? startLine + limit - 1 : startLine + lines.length - 1;

  if (!content) return null;

  return (
    <CodeBlockViewer
      fileName={filePath}
      content={content}
      startLine={startLine}
      endLine={endLine}
    />
  );
}
