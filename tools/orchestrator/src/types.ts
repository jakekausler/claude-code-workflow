import type { PipelineConfig } from 'kanban-cli';

export interface WorkerInfo {
  pid: number;
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
}
