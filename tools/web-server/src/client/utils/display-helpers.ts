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
 * Strips XML noise tags from display content.
 */
export function sanitizeDisplayContent(content: string): string {
  let result = content;
  result = result.replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, '');
  result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  result = result.replace(/<command-name>\/?([^<]+)<\/command-name>/g, '/$1');
  return result.trim();
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
