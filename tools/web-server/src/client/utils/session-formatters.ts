/**
 * Format token count with K/M suffix.
 * 500 -> "500", 12300 -> "12.3K", 1500000 -> "1.5M"
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
 * 5000 -> "5s", 125000 -> "2m 5s", 3661000 -> "1h 1m"
 */
export function formatDuration(ms: number): string {
  if (ms === 0) return '0s';
  if (ms > 0 && ms < 1000) return `${Math.round(ms)}ms`;
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
  return str.slice(0, maxLen - 1) + '\u2026';
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
        return `${name} \u2014 lines ${offset}-${limit}`;
      }
      return name;
    }
    case 'Write': {
      const fp = input.file_path as string | undefined;
      if (!fp) return 'Write';
      const name = extractFilename(fp);
      const content = input.content as string | undefined;
      if (content) {
        const lineCount = (content.match(/\n/g) || []).length + 1;
        return `${name} - ${lineCount} line${lineCount !== 1 ? 's' : ''}`;
      }
      return name;
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
      if (type && desc) return `${type} \u2014 ${truncate(desc, 30)}`;
      if (desc) return truncate(desc, 40);
      return 'Task';
    }
    case 'Skill': {
      const skill = input.skill as string | undefined;
      return skill || 'Skill';
    }
    case 'WebFetch': {
      const url = input.url as string | undefined;
      if (url) {
        try {
          const urlObj = new URL(url);
          return truncate(urlObj.hostname + urlObj.pathname, 50);
        } catch {
          return truncate(url, 50);
        }
      }
      return 'WebFetch';
    }
    case 'WebSearch': {
      const query = input.query as string | undefined;
      return query ? `"${truncate(query, 40)}"` : 'WebSearch';
    }
    case 'NotebookEdit': {
      const notebookPath = input.notebook_path as string | undefined;
      const editMode = input.edit_mode as string | undefined;
      if (notebookPath) {
        const nbName = extractFilename(notebookPath);
        return editMode ? `${editMode} - ${nbName}` : nbName;
      }
      return 'NotebookEdit';
    }
    case 'TodoWrite': {
      const todos = input.todos as unknown[] | undefined;
      if (Array.isArray(todos)) {
        return `${todos.length} item${todos.length !== 1 ? 's' : ''}`;
      }
      return 'TodoWrite';
    }
    case 'TaskCreate': {
      const subject = input.subject as string | undefined;
      return subject ? truncate(subject, 50) : 'TaskCreate';
    }
    case 'TaskUpdate': {
      const taskId = input.taskId as string | undefined;
      const status = input.status as string | undefined;
      if (taskId && status) return `#${taskId} ${status}`;
      if (taskId) return `#${taskId}`;
      return 'TaskUpdate';
    }
    case 'TaskList':
      return 'List tasks';
    case 'TaskGet': {
      const taskId = input.taskId as string | undefined;
      return taskId ? `Get task #${taskId}` : 'TaskGet';
    }
    default: {
      // Try common parameter names before falling back to tool name
      const nameField =
        input.name ?? input.path ?? input.file ?? input.query ?? input.command;
      if (typeof nameField === 'string') {
        return truncate(nameField, 50);
      }
      return toolName;
    }
  }
}

/**
 * Extract string content from a ToolResult.
 * Returns the content as-is if string, or JSON-stringified if array/object.
 */
export function extractResultContent(result: { content: string | unknown[]; isError: boolean } | undefined): string | null {
  if (!result) return null;
  return typeof result.content === 'string'
    ? result.content
    : JSON.stringify(result.content, null, 2);
}

/**
 * Format a Date (or ISO string / epoch ms) as a local time string (HH:MM).
 * Accepts Date objects, ISO 8601 strings, or numeric timestamps (ms since epoch).
 * Returns an empty string for invalid / unparseable values.
 */
export function formatTimestamp(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
