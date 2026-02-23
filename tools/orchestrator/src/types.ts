import type { PipelineConfig } from 'kanban-cli';

export interface WorkerInfo {
  stageId: string;
  stageFilePath: string;
  worktreePath: string;
  worktreeIndex: number;
  statusBefore: string;
  startTime: number;
}

export interface OrchestratorConfig {
  repoPath: string;
  once: boolean;
  idleSeconds: number;
  logDir: string;
  model: string;
  verbose: boolean;
  maxParallel: number;
  pipelineConfig: PipelineConfig;
  workflowEnv: Record<string, string>;
  mockMode: 'none' | 'full' | 'selective';
  mockServices: string[];  // empty for 'none' and 'full', populated for 'selective'
}
