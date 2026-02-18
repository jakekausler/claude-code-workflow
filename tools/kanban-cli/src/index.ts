// Types
export type {
  PipelineConfig,
  PipelineState,
  WorkflowDefaults,
  SkillState,
  ResolverState,
} from './types/pipeline.js';
export {
  RESERVED_STATUSES,
  DONE_TARGET,
  isSkillState,
  isResolverState,
} from './types/pipeline.js';

// Config
export { pipelineConfigSchema } from './config/schema.js';
export type { ValidatedPipelineConfig } from './config/schema.js';
export { loadConfig, mergeConfigs, CONFIG_PATHS } from './config/loader.js';
export { defaultPipelineConfig } from './config/defaults.js';

// Engine
export { StateMachine } from './engine/state-machine.js';
export { TransitionValidator } from './engine/transitions.js';
export type { TransitionResult } from './engine/transitions.js';

// Resolvers
export type { ResolverFn, ResolverStageInput, ResolverContext } from './resolvers/types.js';
export { ResolverRegistry } from './resolvers/registry.js';
export { registerBuiltinResolvers } from './resolvers/builtins/index.js';
export { prStatusResolver } from './resolvers/builtins/pr-status.js';
export { stageRouterResolver } from './resolvers/builtins/stage-router.js';

// Validators
export { validateConfig } from './validators/config-validator.js';
export { validateGraph } from './validators/graph-validator.js';
export { validateSkillContent } from './validators/skill-validator.js';
export type { SkillFileReader, SkillContentAnalyzer } from './validators/skill-validator.js';
export { validateResolvers } from './validators/resolver-validator.js';
export { validatePipeline } from './validators/pipeline-validator.js';
export type { PipelineValidationResult, PipelineValidationOptions } from './validators/pipeline-validator.js';

// Work Item Types
export type {
  Epic,
  Ticket,
  Stage,
  Dependency,
  WorkItemType,
  RepoRecord,
  SystemColumn,
  KanbanColumn,
} from './types/work-items.js';
export { SYSTEM_COLUMNS } from './types/work-items.js';

// Database
export { KanbanDatabase, DEFAULT_DB_PATH } from './db/database.js';
export { ALL_CREATE_STATEMENTS } from './db/schema.js';

// Repositories
export {
  RepoRepository,
  EpicRepository,
  TicketRepository,
  StageRepository,
  DependencyRepository,
} from './db/repositories/index.js';
export type {
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
  EpicUpsertData,
  TicketUpsertData,
  StageUpsertData,
  DependencyUpsertData,
} from './db/repositories/index.js';

// Parser
export {
  parseFrontmatterRaw,
  parseEpicFrontmatter,
  parseTicketFrontmatter,
  parseStageFrontmatter,
  parseFrontmatter,
} from './parser/frontmatter.js';
export { discoverWorkItems } from './parser/discovery.js';
export type { DiscoveredFile } from './parser/discovery.js';

// Kanban Columns
export { computeKanbanColumn } from './engine/kanban-columns.js';
export type { KanbanColumnInput } from './engine/kanban-columns.js';

// Sync
export { syncRepo } from './sync/sync.js';
export type { SyncOptions, SyncResult } from './sync/sync.js';
