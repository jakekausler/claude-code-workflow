#!/usr/bin/env node
import { Command } from 'commander';
import { loadOrchestratorConfig } from './config.js';
import { createLogger } from './logger.js';
import { createDiscovery } from './discovery.js';
import { createLocker, defaultReadFrontmatter, defaultWriteFrontmatter } from './locking.js';
import { createWorktreeManager } from './worktree.js';
import { createSessionExecutor } from './session.js';
import { createMockSessionExecutor } from './mock-session.js';
import { createMockWorktreeManager } from './mock-worktree.js';
import { createOrchestrator } from './loop.js';
import { setupShutdownHandlers } from './shutdown.js';

const program = new Command()
  .name('orchestrator')
  .description('Kanban workflow orchestrator')
  .option('--repo <path>', 'Target repository', process.cwd())
  .option('--once', 'Run single tick then exit', false)
  .option('--idle-seconds <n>', 'Wait time when no stages', '30')
  .option('--log-dir <path>', 'Session log directory')
  .option('--model <model>', 'Claude model for sessions', 'sonnet')
  .option('--verbose', 'Verbose output', false)
  .option('--mock [services]', 'Mock mode: no args = full mock (auto-advance, no CLI), or comma-separated services to mock (jira,github,gitlab,slack)')
  .action(async (options) => {
    try {
      // 1. Load config
      const config = await loadOrchestratorConfig({
        repo: options.repo,
        once: options.once,
        idleSeconds: options.idleSeconds,
        logDir: options.logDir,
        model: options.model,
        verbose: options.verbose,
        mock: options.mock,
      });

      // 2. Create all dependencies
      const logger = createLogger(config.verbose);
      const discovery = createDiscovery();
      const locker = createLocker();

      let worktreeManager;
      let sessionExecutor;

      if (config.mockMode === 'full') {
        logger.info('Running in full mock mode (auto-advancing stages)');
        worktreeManager = createMockWorktreeManager();
        sessionExecutor = createMockSessionExecutor({
          readFrontmatter: defaultReadFrontmatter,
          writeFrontmatter: defaultWriteFrontmatter,
          pipelineConfig: config.pipelineConfig,
        });
      } else {
        if (config.mockMode === 'selective') {
          logger.info(`Running with mocked services: ${config.mockServices.join(', ')}`);
        }
        worktreeManager = createWorktreeManager(config.maxParallel);
        sessionExecutor = createSessionExecutor();
      }

      // 3. Create orchestrator
      const orchestrator = createOrchestrator(config, {
        discovery,
        locker,
        worktreeManager,
        sessionExecutor,
        logger,
      });

      // 4. Setup shutdown handlers
      setupShutdownHandlers({
        orchestrator,
        worktreeManager,
        locker,
        sessionExecutor,
        logger,
      });

      // 5. Start orchestrator
      logger.info('Starting orchestrator', {
        repo: config.repoPath,
        maxParallel: config.maxParallel,
        once: config.once,
        model: config.model,
      });
      await orchestrator.start();

      // If start() returns (e.g., --once mode completed), exit normally
      logger.info('Orchestrator finished');
    } catch (err) {
      console.error('Fatal error:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

program.parse();
