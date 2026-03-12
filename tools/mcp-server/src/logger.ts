import { appendFileSync } from 'node:fs';

const LOG_FILE = '/tmp/mcp-server.log';

export function log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: Record<string, unknown>): void {
  const entry = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...data,
  });
  try {
    appendFileSync(LOG_FILE, entry + '\n');
  } catch {
    // Fall back to stderr if file write fails
    process.stderr.write(entry + '\n');
  }
}
