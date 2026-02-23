import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  createSessionLogger(stageId: string, logDir: string): SessionLogger;
}

export interface SessionLogger {
  logFilePath: string;
  write(data: string): void;
  close(): void;
}

/**
 * Injectable dependencies for createLogger.
 * Defaults to real implementations; tests can override.
 */
export interface LoggerDeps {
  writeStderr: (data: string) => void;
  now: () => Date;
  createWriteStream: (filePath: string) => fs.WriteStream;
}

const defaultDeps: LoggerDeps = {
  writeStderr: (data: string) => process.stderr.write(data),
  now: () => new Date(),
  createWriteStream: (filePath: string) => fs.createWriteStream(filePath, { flags: 'a' }),
};

/**
 * Format a Date as a filesystem-safe ISO timestamp.
 * Replaces colons with dashes: 2026-02-23T14-30-00.000Z
 */
function toFileTimestamp(date: Date): string {
  return date.toISOString().replace(/:/g, '-');
}

/**
 * Format a log line for console output.
 * Format: [ISO-timestamp] [LEVEL] message { context }
 */
function formatLogLine(
  timestamp: string,
  level: string,
  message: string,
  context?: Record<string, unknown>,
): string {
  let line = `[${timestamp}] [${level}] ${message}`;
  if (context !== undefined && Object.keys(context).length > 0) {
    line += ` ${JSON.stringify(context)}`;
  }
  return line + '\n';
}

/**
 * Create a structured logger that writes to stderr.
 *
 * - info, warn, error: always shown
 * - debug: only shown when verbose=true
 * - All output goes to stderr (stdout is reserved for program output)
 */
export function createLogger(verbose: boolean, deps: Partial<LoggerDeps> = {}): Logger {
  const { writeStderr, now, createWriteStream } = { ...defaultDeps, ...deps };

  function log(level: string, message: string, context?: Record<string, unknown>): void {
    const timestamp = now().toISOString();
    const line = formatLogLine(timestamp, level, message, context);
    writeStderr(line);
  }

  return {
    info(message: string, context?: Record<string, unknown>): void {
      log('INFO', message, context);
    },

    warn(message: string, context?: Record<string, unknown>): void {
      log('WARN', message, context);
    },

    error(message: string, context?: Record<string, unknown>): void {
      log('ERROR', message, context);
    },

    debug(message: string, context?: Record<string, unknown>): void {
      if (verbose) {
        log('DEBUG', message, context);
      }
    },

    createSessionLogger(stageId: string, logDir: string): SessionLogger {
      const timestamp = toFileTimestamp(now());
      const logFilePath = path.join(logDir, `${stageId}-${timestamp}.log`);
      const stream = createWriteStream(logFilePath);

      return {
        logFilePath,

        write(data: string): void {
          stream.write(data);
        },

        close(): void {
          stream.end();
        },
      };
    },
  };
}
