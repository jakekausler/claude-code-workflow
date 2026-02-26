/**
 * Safe Date conversion for JSON-serialized timestamps.
 */
export function toDate(timestamp: Date | string | number): Date {
  if (timestamp instanceof Date) return timestamp;
  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/**
 * Standard truncation with ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\u2026';
}

/**
 * Checks if content is a command message (starts with command XML tags).
 */
export function isCommandContent(content: string): boolean {
  return content.startsWith('<command-name>') || content.startsWith('<command-message>');
}

/**
 * Checks if content is command output (stdout/stderr).
 */
export function isCommandOutputContent(content: string): boolean {
  return content.startsWith('<local-command-stdout>') || content.startsWith('<local-command-stderr>');
}

/**
 * Extracts structured slash info from command XML tags.
 */
export interface SlashInfo {
  name: string;
  message?: string;
  args?: string;
}

export function extractSlashInfo(content: string): SlashInfo | null {
  const nameMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
  if (!nameMatch) return null;

  const name = nameMatch[1].trim();
  const messageMatch = /<command-message>([^<]*)<\/command-message>/.exec(content);
  const argsMatch = /<command-args>([^<]*)<\/command-args>/.exec(content);

  return {
    name,
    message: messageMatch?.[1]?.trim() || undefined,
    args: argsMatch?.[1]?.trim() || undefined,
  };
}

/**
 * Strips XML noise tags and command tags from display content.
 * Priority: command output > command content > strip noise > strip remaining tags.
 */
export function sanitizeDisplayContent(content: string): string {
  // If it's command output, extract the output content
  if (isCommandOutputContent(content)) {
    const stdoutMatch = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i.exec(content);
    const stderrMatch = /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/i.exec(content);
    if (stdoutMatch) return stdoutMatch[1].trim();
    if (stderrMatch) return stderrMatch[1].trim();
  }

  // If it's a command message, extract clean display format
  if (isCommandContent(content)) {
    const nameMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
    if (nameMatch) {
      const commandName = `/${nameMatch[1].trim()}`;
      const argsMatch = /<command-args>([^<]*)<\/command-args>/.exec(content);
      const args = argsMatch?.[1]?.trim();
      return args ? `${commandName} ${args}` : commandName;
    }
  }

  // Remove noise tags
  let sanitized = content;
  sanitized = sanitized.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '');
  sanitized = sanitized.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '');

  // Strip any remaining command tags from mixed content
  sanitized = sanitized.replace(/<command-name>[\s\S]*?<\/command-name>/gi, '');
  sanitized = sanitized.replace(/<command-message>[\s\S]*?<\/command-message>/gi, '');
  sanitized = sanitized.replace(/<command-args>[\s\S]*?<\/command-args>/gi, '');

  return sanitized.trim();
}

/**
 * Format tool input as JSON string with truncation for preview display.
 */
export function formatToolInput(input: unknown): string {
  try {
    const json = JSON.stringify(input, null, 2);
    return truncateText(json, 100);
  } catch {
    return String(input);
  }
}

/**
 * Extract text from tool result content for preview display.
 */
export function formatToolResult(content: string | unknown[]): string {
  if (typeof content === 'string') {
    return truncateText(content, 200);
  }
  if (Array.isArray(content)) {
    const texts = content
      .filter((block): block is { type: 'text'; text: string } => {
        if (block == null || typeof block !== 'object') return false;
        const b = block as Record<string, unknown>;
        return b.type === 'text' && typeof b.text === 'string';
      })
      .map((block) => block.text);
    if (texts.length > 0) {
      return truncateText(texts.join('\n'), 200);
    }
    return truncateText(JSON.stringify(content), 200);
  }
  return '';
}

/**
 * Extract text content from content blocks using type guards.
 * Used by group-transformer and display-item-builder.
 */
export function extractTextContent(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block): block is { type: 'text'; text: string } => {
        if (block == null || typeof block !== 'object') return false;
        const b = block as Record<string, unknown>;
        return b.type === 'text' && typeof b.text === 'string';
      })
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}
