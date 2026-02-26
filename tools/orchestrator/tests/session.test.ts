import { describe, it, expect, vi } from 'vitest';
import {
  assemblePrompt,
  createSessionExecutor,
  type SpawnOptions,
  type SessionDeps,
  type ChildProcessLike,
  type SessionLoggerLike,
  type SpawnProcessOptions,
} from '../src/session.js';

/** Build a default SpawnOptions for testing. */
function makeSpawnOptions(overrides: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    stageId: 'STAGE-001-001-001',
    stageFilePath: '/repo/epics/epic-001/tickets/ticket-001/stages/stage-001.md',
    skillName: 'implement',
    worktreePath: '/repo/.worktrees/worktree-1',
    worktreeIndex: 1,
    model: 'opus',
    workflowEnv: {
      WORKFLOW_AUTO_DESIGN: 'true',
      WORKFLOW_REMOTE_MODE: 'false',
    },
    ...overrides,
  };
}

/** Build a mock session logger. */
function makeLogger(): SessionLoggerLike & { write: ReturnType<typeof vi.fn> } {
  return {
    write: vi.fn(),
  };
}

type CloseListener = (code: number | null) => void;
type ErrorListener = (err: Error) => void;
type DataListener = (chunk: Buffer) => void;

/** Build a mock child process with controllable events. */
function makeMockChild(pid = 12345): {
  child: ChildProcessLike;
  emitClose: (code: number | null) => void;
  emitError: (err: Error) => void;
  emitStdout: (data: string) => void;
  emitStderr: (data: string) => void;
  stdinWrite: ReturnType<typeof vi.fn>;
  stdinEnd: ReturnType<typeof vi.fn>;
  killFn: ReturnType<typeof vi.fn>;
} {
  const closeListeners: CloseListener[] = [];
  const errorListeners: ErrorListener[] = [];
  const stdoutListeners: DataListener[] = [];
  const stderrListeners: DataListener[] = [];
  const stdinWrite = vi.fn(() => true);
  const stdinEnd = vi.fn();
  const killFn = vi.fn(() => true);

  const child: ChildProcessLike = {
    pid,
    stdin: { write: stdinWrite, end: stdinEnd },
    stdout: {
      on(_event: 'data', listener: DataListener) {
        stdoutListeners.push(listener);
      },
    },
    stderr: {
      on(_event: 'data', listener: DataListener) {
        stderrListeners.push(listener);
      },
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (event === 'close') closeListeners.push(listener as CloseListener);
      if (event === 'error') errorListeners.push(listener as ErrorListener);
    },
    kill: killFn,
  };

  return {
    child,
    emitClose: (code) => closeListeners.forEach((l) => l(code)),
    emitError: (err) => errorListeners.forEach((l) => l(err)),
    emitStdout: (data) => stdoutListeners.forEach((l) => l(Buffer.from(data))),
    emitStderr: (data) => stderrListeners.forEach((l) => l(Buffer.from(data))),
    stdinWrite,
    stdinEnd,
    killFn,
  };
}

/** Build mock deps with a controllable child process. */
function makeDeps(
  mockChild: ReturnType<typeof makeMockChild>,
  overrides: Partial<SessionDeps> = {},
): SessionDeps & { spawnProcess: ReturnType<typeof vi.fn>; now: ReturnType<typeof vi.fn> } {
  let time = 1000;
  return {
    spawnProcess: vi.fn(() => mockChild.child),
    now: vi.fn(() => time++),
    ...overrides,
  };
}

describe('assemblePrompt', () => {
  it('includes stageId in the prompt', () => {
    const options = makeSpawnOptions();
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('STAGE-001-001-001');
  });

  it('includes stageFilePath in the prompt', () => {
    const options = makeSpawnOptions();
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('/repo/epics/epic-001/tickets/ticket-001/stages/stage-001.md');
  });

  it('includes worktreePath in the prompt', () => {
    const options = makeSpawnOptions();
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('/repo/.worktrees/worktree-1');
  });

  it('includes worktreeIndex in the prompt', () => {
    const options = makeSpawnOptions({ worktreeIndex: 3 });
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('Worktree index: 3');
  });

  it('includes skillName in the prompt', () => {
    const options = makeSpawnOptions({ skillName: 'design-review' });
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('`design-review`');
  });

  it('includes skill invocation instructions', () => {
    const options = makeSpawnOptions();
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('Invoke the `ticket-stage-workflow` skill to load shared context.');
    expect(prompt).toContain('Then invoke the `implement` skill to begin work on this stage.');
  });

  it('lists environment variables alphabetically', () => {
    const options = makeSpawnOptions({
      workflowEnv: {
        WORKFLOW_REMOTE_MODE: 'false',
        WORKFLOW_AUTO_DESIGN: 'true',
        WORKFLOW_DRY_RUN: 'yes',
      },
    });
    const prompt = assemblePrompt(options);

    const envLines = prompt.split('\n').filter((line) => line.startsWith('- WORKFLOW_'));
    expect(envLines).toEqual([
      '- WORKFLOW_AUTO_DESIGN=true',
      '- WORKFLOW_DRY_RUN=yes',
      '- WORKFLOW_REMOTE_MODE=false',
    ]);
  });

  it('handles empty workflowEnv', () => {
    const options = makeSpawnOptions({ workflowEnv: {} });
    const prompt = assemblePrompt(options);

    expect(prompt).toContain('Environment configuration:');
    // No env var lines after the header
    const lines = prompt.split('\n');
    const configIdx = lines.indexOf('Environment configuration:');
    expect(configIdx).toBeGreaterThan(-1);
    // Nothing follows the header
    expect(lines.slice(configIdx + 1).filter((l) => l.trim().length > 0)).toHaveLength(0);
  });
});

describe('createSessionExecutor', () => {
  describe('spawn', () => {
    it('passes correct args to claude CLI', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions({ model: 'sonnet' });

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      expect(deps.spawnProcess).toHaveBeenCalledWith(
        'claude',
        ['-p', '--model', 'sonnet', '--output-format', 'stream-json', '--input-format', 'stream-json'],
        expect.objectContaining({
          cwd: options.worktreePath,
          stdio: ['pipe', 'pipe', 'pipe'],
        }),
      );
    });

    it('sets cwd to worktree path', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions({ worktreePath: '/custom/worktree/path' });

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      const callArgs = deps.spawnProcess.mock.calls[0];
      const processOptions = callArgs[2] as SpawnProcessOptions;
      expect(processOptions.cwd).toBe('/custom/worktree/path');
    });

    it('sets WORKTREE_INDEX in env', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions({ worktreeIndex: 7 });

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      const callArgs = deps.spawnProcess.mock.calls[0];
      const processOptions = callArgs[2] as SpawnProcessOptions;
      expect(processOptions.env.WORKTREE_INDEX).toBe('7');
    });

    it('passes workflowEnv vars to child env', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions({
        workflowEnv: { MY_CUSTOM_VAR: 'hello', ANOTHER_VAR: 'world' },
      });

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      const callArgs = deps.spawnProcess.mock.calls[0];
      const processOptions = callArgs[2] as SpawnProcessOptions;
      expect(processOptions.env.MY_CUSTOM_VAR).toBe('hello');
      expect(processOptions.env.ANOTHER_VAR).toBe('world');
    });

    it('writes prompt to stdin', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      expect(mock.stdinWrite).toHaveBeenCalledTimes(1);
      const writtenPrompt = mock.stdinWrite.mock.calls[0][0] as string;
      expect(writtenPrompt).toContain('STAGE-001-001-001');
      expect(mock.stdinEnd).toHaveBeenCalledTimes(1);
    });

    it('pipes stdout to session logger', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStdout('hello from stdout');
      mock.emitClose(0);
      await promise;

      expect(logger.write).toHaveBeenCalledWith('hello from stdout');
    });

    it('pipes stderr to session logger', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStderr('warning from stderr');
      mock.emitClose(0);
      await promise;

      expect(logger.write).toHaveBeenCalledWith('warning from stderr');
    });

    it('resolves with exit code on completion', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitClose(42);
      const result = await promise;

      expect(result.exitCode).toBe(42);
    });

    it('resolves with exit code 1 when close code is null', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitClose(null);
      const result = await promise;

      expect(result.exitCode).toBe(1);
    });

    it('reports duration in milliseconds', async () => {
      const mock = makeMockChild();
      let callCount = 0;
      const deps = makeDeps(mock, {
        now: vi.fn(() => {
          callCount++;
          // First call (start): 1000, second call (close): 3500
          return callCount === 1 ? 1000 : 3500;
        }),
      });
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      const result = await promise;

      expect(result.durationMs).toBe(2500);
    });

    it('rejects on process error', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitError(new Error('spawn ENOENT'));

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('tracks active session during execution', async () => {
      const mock = makeMockChild(99999);
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);

      // Session should be active before close
      const active = executor.getActiveSessions();
      expect(active).toHaveLength(1);
      expect(active[0].pid).toBe(99999);

      mock.emitClose(0);
      await promise;
    });

    it('removes session from active list after completion', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      expect(executor.getActiveSessions()).toHaveLength(0);
    });

    it('removes session from active list after error', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitError(new Error('process failed'));

      try {
        await promise;
      } catch {
        // expected rejection
      }

      expect(executor.getActiveSessions()).toHaveLength(0);
    });

    it('does not track session when pid is undefined', async () => {
      const mock = makeMockChild();
      // Override pid to undefined to simulate a failed spawn
      (mock.child as { pid: number | undefined }).pid = undefined;
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);

      // Session should not appear in active list
      expect(executor.getActiveSessions()).toHaveLength(0);

      // stdin should not have been written to
      expect(mock.stdinWrite).not.toHaveBeenCalled();
      expect(mock.stdinEnd).not.toHaveBeenCalled();

      mock.emitClose(1);
      await promise;
    });

    it('forwards multiple stdout chunks to logger', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStdout('chunk-1');
      mock.emitStdout('chunk-2');
      mock.emitStdout('chunk-3');
      mock.emitClose(0);
      await promise;

      expect(logger.write).toHaveBeenCalledWith('chunk-1');
      expect(logger.write).toHaveBeenCalledWith('chunk-2');
      expect(logger.write).toHaveBeenCalledWith('chunk-3');
      expect(logger.write).toHaveBeenCalledTimes(3);
    });

    it('forwards multiple stderr chunks to logger', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStderr('err-1');
      mock.emitStderr('err-2');
      mock.emitClose(0);
      await promise;

      expect(logger.write).toHaveBeenCalledWith('err-1');
      expect(logger.write).toHaveBeenCalledWith('err-2');
      expect(logger.write).toHaveBeenCalledTimes(2);
    });

    it('forwards interleaved stdout and stderr chunks to logger', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStdout('out-1');
      mock.emitStderr('err-1');
      mock.emitStdout('out-2');
      mock.emitClose(0);
      await promise;

      expect(logger.write).toHaveBeenCalledTimes(3);
      expect(logger.write).toHaveBeenNthCalledWith(1, 'out-1');
      expect(logger.write).toHaveBeenNthCalledWith(2, 'err-1');
      expect(logger.write).toHaveBeenNthCalledWith(3, 'out-2');
    });

    it('includes stream-json output and input format flags', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const options = makeSpawnOptions({ model: 'opus' });

      const promise = executor.spawn(options, logger);
      mock.emitClose(0);
      await promise;

      const callArgs = deps.spawnProcess.mock.calls[0];
      const args = callArgs[1] as string[];
      expect(args).toContain('--output-format');
      expect(args).toContain('--input-format');
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
      expect(args[args.indexOf('--input-format') + 1]).toBe('stream-json');
    });

    it('fires onSessionId callback when stdout contains a session ID', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const onSessionId = vi.fn();
      const options = makeSpawnOptions({ onSessionId });

      const promise = executor.spawn(options, logger);
      mock.emitStdout('{"type":"init","session_id":"sess-abc-123"}\n');
      mock.emitClose(0);
      await promise;

      expect(onSessionId).toHaveBeenCalledTimes(1);
      expect(onSessionId).toHaveBeenCalledWith('sess-abc-123');
    });

    it('fires onSessionId only once for multiple session_id messages', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const onSessionId = vi.fn();
      const options = makeSpawnOptions({ onSessionId });

      const promise = executor.spawn(options, logger);
      mock.emitStdout('{"type":"init","session_id":"sess-first"}\n');
      mock.emitStdout('{"type":"update","session_id":"sess-second"}\n');
      mock.emitClose(0);
      await promise;

      expect(onSessionId).toHaveBeenCalledTimes(1);
      expect(onSessionId).toHaveBeenCalledWith('sess-first');
    });

    it('does not error when onSessionId is not provided', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      // No onSessionId callback — should not throw
      const options = makeSpawnOptions();

      const promise = executor.spawn(options, logger);
      mock.emitStdout('{"type":"init","session_id":"sess-xyz"}\n');
      mock.emitClose(0);
      await promise;

      // Just verify we completed without error
      expect(logger.write).toHaveBeenCalled();
    });

    it('still pipes stdout to logger when stream parser is active', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const onSessionId = vi.fn();
      const options = makeSpawnOptions({ onSessionId });

      const promise = executor.spawn(options, logger);
      mock.emitStdout('{"type":"init","session_id":"sess-abc"}\n');
      mock.emitStdout('{"type":"assistant","text":"hello"}\n');
      mock.emitClose(0);
      await promise;

      // Logger received both chunks
      expect(logger.write).toHaveBeenCalledTimes(2);
      expect(logger.write).toHaveBeenCalledWith('{"type":"init","session_id":"sess-abc"}\n');
      expect(logger.write).toHaveBeenCalledWith('{"type":"assistant","text":"hello"}\n');
      // And onSessionId also fired
      expect(onSessionId).toHaveBeenCalledWith('sess-abc');
    });

    it('flushes stream parser on process close', async () => {
      const mock = makeMockChild();
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();
      const onSessionId = vi.fn();
      const options = makeSpawnOptions({ onSessionId });

      const promise = executor.spawn(options, logger);
      // Send data without trailing newline — parser buffers it
      mock.emitStdout('{"type":"init","session_id":"sess-flush"}');
      mock.emitClose(0);
      await promise;

      // The flush on close should have processed the buffered line
      expect(onSessionId).toHaveBeenCalledTimes(1);
      expect(onSessionId).toHaveBeenCalledWith('sess-flush');
    });
  });

  describe('getActiveSessions', () => {
    it('returns empty array when no sessions are active', () => {
      const executor = createSessionExecutor({ now: () => 0, spawnProcess: vi.fn() });

      expect(executor.getActiveSessions()).toEqual([]);
    });

    it('returns tracked sessions', async () => {
      const mock1 = makeMockChild(111);
      const mock2 = makeMockChild(222);
      let callIndex = 0;
      const deps: SessionDeps = {
        spawnProcess: vi.fn(() => {
          callIndex++;
          return callIndex === 1 ? mock1.child : mock2.child;
        }),
        now: () => 1000,
      };
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();

      // Spawn two sessions without closing them
      executor.spawn(makeSpawnOptions(), logger);
      executor.spawn(makeSpawnOptions(), logger);

      const active = executor.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.map((s) => s.pid).sort()).toEqual([111, 222]);

      // Clean up
      mock1.emitClose(0);
      mock2.emitClose(0);
    });
  });

  describe('killAll', () => {
    it('sends signal to all active sessions', async () => {
      const mock1 = makeMockChild(111);
      const mock2 = makeMockChild(222);
      let callIndex = 0;
      const deps: SessionDeps = {
        spawnProcess: vi.fn(() => {
          callIndex++;
          return callIndex === 1 ? mock1.child : mock2.child;
        }),
        now: () => 1000,
      };
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();

      executor.spawn(makeSpawnOptions(), logger);
      executor.spawn(makeSpawnOptions(), logger);

      executor.killAll();

      expect(mock1.killFn).toHaveBeenCalledWith('SIGTERM');
      expect(mock2.killFn).toHaveBeenCalledWith('SIGTERM');

      // Clean up
      mock1.emitClose(0);
      mock2.emitClose(0);
    });

    it('sends custom signal when provided', async () => {
      const mock = makeMockChild(333);
      const deps = makeDeps(mock);
      const executor = createSessionExecutor(deps);
      const logger = makeLogger();

      executor.spawn(makeSpawnOptions(), logger);

      executor.killAll('SIGKILL');

      expect(mock.killFn).toHaveBeenCalledWith('SIGKILL');

      // Clean up
      mock.emitClose(0);
    });

    it('does nothing when no sessions are active', () => {
      const executor = createSessionExecutor({ now: () => 0, spawnProcess: vi.fn() });

      // Should not throw
      executor.killAll();
    });
  });
});
