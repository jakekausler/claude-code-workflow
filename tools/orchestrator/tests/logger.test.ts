import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLogger, type LoggerDeps } from '../src/logger.js';

/** Fixed date for deterministic tests. */
const FIXED_DATE = new Date('2026-02-23T14:30:00.000Z');
const FIXED_ISO = '2026-02-23T14:30:00.000Z';
const FIXED_FILE_TIMESTAMP = '2026-02-23T14-30-00.000Z';

/** Create test deps with captured stderr output. */
function makeDeps(overrides?: Partial<LoggerDeps>): LoggerDeps & { stderrOutput: string[] } {
  const stderrOutput: string[] = [];
  return {
    writeStderr: vi.fn((data: string) => stderrOutput.push(data)),
    now: vi.fn(() => FIXED_DATE),
    createWriteStream: vi.fn(() => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn((cb?: () => void) => { if (cb) cb(); }),
        on: vi.fn(),
      } as unknown as fs.WriteStream;
      return mockStream;
    }),
    stderrOutput,
    ...overrides,
  };
}

describe('createLogger', () => {
  describe('console output format', () => {
    it('formats info messages as [timestamp] [INFO] message', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('server started');

      expect(deps.stderrOutput).toHaveLength(1);
      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [INFO] server started\n`,
      );
    });

    it('formats warn messages as [timestamp] [WARN] message', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.warn('disk space low');

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [WARN] disk space low\n`,
      );
    });

    it('formats error messages as [timestamp] [ERROR] message', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.error('connection failed');

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [ERROR] connection failed\n`,
      );
    });

    it('formats debug messages as [timestamp] [DEBUG] message', () => {
      const deps = makeDeps();
      const logger = createLogger(true, deps);

      logger.debug('cache miss');

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [DEBUG] cache miss\n`,
      );
    });

    it('serializes context object in log output', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('request', { method: 'GET', path: '/api' });

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [INFO] request {"method":"GET","path":"/api"}\n`,
      );
    });

    it('omits context when not provided', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('simple message');

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [INFO] simple message\n`,
      );
      expect(deps.stderrOutput[0]).not.toContain('{}');
    });

    it('omits context when empty object is provided', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('simple message', {});

      expect(deps.stderrOutput[0]).toBe(
        `[${FIXED_ISO}] [INFO] simple message\n`,
      );
    });
  });

  describe('verbose mode', () => {
    it('shows debug messages when verbose=true', () => {
      const deps = makeDeps();
      const logger = createLogger(true, deps);

      logger.debug('trace info');

      expect(deps.stderrOutput).toHaveLength(1);
      expect(deps.stderrOutput[0]).toContain('[DEBUG]');
    });

    it('suppresses debug messages when verbose=false', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.debug('trace info');

      expect(deps.stderrOutput).toHaveLength(0);
    });

    it('shows info regardless of verbose setting', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('always shown');

      expect(deps.stderrOutput).toHaveLength(1);
    });

    it('shows warn regardless of verbose setting', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.warn('always shown');

      expect(deps.stderrOutput).toHaveLength(1);
    });

    it('shows error regardless of verbose setting', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.error('always shown');

      expect(deps.stderrOutput).toHaveLength(1);
    });
  });

  describe('all output goes to stderr', () => {
    it('writes info to stderr via writeStderr', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.info('test');

      expect(deps.writeStderr).toHaveBeenCalledTimes(1);
    });

    it('writes warn to stderr via writeStderr', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.warn('test');

      expect(deps.writeStderr).toHaveBeenCalledTimes(1);
    });

    it('writes error to stderr via writeStderr', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);

      logger.error('test');

      expect(deps.writeStderr).toHaveBeenCalledTimes(1);
    });
  });

  describe('session logger', () => {
    it('creates file at correct path format', () => {
      const mockCreateWriteStream = vi.fn(() => ({
        write: vi.fn(),
        end: vi.fn((cb?: () => void) => { if (cb) cb(); }),
        on: vi.fn(),
      } as unknown as fs.WriteStream));

      const deps = makeDeps({ createWriteStream: mockCreateWriteStream });
      const logger = createLogger(false, deps);

      const session = logger.createSessionLogger('STAGE-123', '/tmp/logs');

      expect(session.logFilePath).toBe(
        `/tmp/logs/STAGE-123-${FIXED_FILE_TIMESTAMP}.log`,
      );
      expect(mockCreateWriteStream).toHaveBeenCalledWith(session.logFilePath);
    });

    it('writes data to the stream', () => {
      const mockWrite = vi.fn();
      const mockCreateWriteStream = vi.fn(() => ({
        write: mockWrite,
        end: vi.fn((cb?: () => void) => { if (cb) cb(); }),
        on: vi.fn(),
      } as unknown as fs.WriteStream));

      const deps = makeDeps({ createWriteStream: mockCreateWriteStream });
      const logger = createLogger(false, deps);
      const session = logger.createSessionLogger('STAGE-1', '/tmp/logs');

      session.write('line 1\n');
      session.write('line 2\n');

      expect(mockWrite).toHaveBeenCalledTimes(2);
      expect(mockWrite).toHaveBeenCalledWith('line 1\n');
      expect(mockWrite).toHaveBeenCalledWith('line 2\n');
    });

    it('close ends the stream and returns a promise', async () => {
      const mockEnd = vi.fn((cb?: () => void) => { if (cb) cb(); });
      const mockCreateWriteStream = vi.fn(() => ({
        write: vi.fn(),
        end: mockEnd,
        on: vi.fn(),
      } as unknown as fs.WriteStream));

      const deps = makeDeps({ createWriteStream: mockCreateWriteStream });
      const logger = createLogger(false, deps);
      const session = logger.createSessionLogger('STAGE-1', '/tmp/logs');

      const result = session.close();
      expect(result).toBeInstanceOf(Promise);
      await result;

      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('uses filesystem-safe timestamp (no colons)', () => {
      const deps = makeDeps();
      const logger = createLogger(false, deps);
      const session = logger.createSessionLogger('test-stage', '/tmp/logs');

      // Should not contain colons in the filename
      const filename = path.basename(session.logFilePath);
      expect(filename).not.toContain(':');
      expect(filename).toBe(`test-stage-${FIXED_FILE_TIMESTAMP}.log`);
    });

    it('creates file and writes data with real fs', async () => {
      const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'logger-test-'));

      try {
        const logger = createLogger(false, {
          writeStderr: () => {},
          now: () => FIXED_DATE,
        });

        const session = logger.createSessionLogger('REAL-STAGE', tmpDir);

        session.write('hello world\n');
        session.write('second line\n');

        await session.close();

        const contents = await fsPromises.readFile(session.logFilePath, 'utf-8');
        expect(contents).toBe('hello world\nsecond line\n');
      } finally {
        await fsPromises.rm(tmpDir, { recursive: true });
      }
    });
  });
});
