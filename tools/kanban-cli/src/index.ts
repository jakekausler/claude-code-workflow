// Types
export type {
  PipelineConfig,
  PipelineState,
  WorkflowDefaults,
  JiraConfig,
  JiraStatusMap,
  SkillState,
  ResolverState,
} from './types/pipeline.js';
export {
  RESERVED_STATUSES,
  DONE_TARGET,
  COMPLETE_STATUS,
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
export type { PRStatus, CodeHostAdapter } from './resolvers/types.js';
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
  SummaryRepository,
} from './db/repositories/index.js';
export type {
  EpicRow,
  TicketRow,
  StageRow,
  DependencyRow,
  SummaryRow,
  EpicUpsertData,
  TicketUpsertData,
  StageUpsertData,
  DependencyUpsertData,
  SummaryUpsertData,
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
export { computeKanbanColumn, toColumnKey } from './engine/kanban-columns.js';
export type { KanbanColumnInput } from './engine/kanban-columns.js';

// Sync
export { syncRepo } from './sync/sync.js';
export type { SyncOptions, SyncResult } from './sync/sync.js';

// CLI Logic (usable as library)
export { buildBoard } from './cli/logic/board.js';
export type {
  BoardOutput,
  BoardItem,
  TicketBoardItem,
  StageBoardItem,
  BuildBoardInput,
  BoardFilters,
} from './cli/logic/board.js';
export { buildGraph } from './cli/logic/graph.js';
export type {
  GraphOutput,
  GraphNode,
  GraphEdge,
  BuildGraphInput,
  GraphFilters,
} from './cli/logic/graph.js';
export { buildNext, computePriorityScore } from './cli/logic/next.js';
export type {
  NextOutput,
  ReadyStage,
  BuildNextInput,
} from './cli/logic/next.js';
export { validateWorkItems } from './cli/logic/validate.js';
export type {
  ValidateOutput,
  ValidationError,
  ValidationWarning,
  ValidateInput,
} from './cli/logic/validate.js';
export { buildSummary } from './cli/logic/summary.js';
export type {
  BuildSummaryInput,
  SummaryOutput,
} from './cli/logic/summary.js';
export { SummaryEngine, computeHash } from './cli/logic/summary-engine.js';
export type {
  SummaryResult,
  SummaryItemType,
  StageSummaryInput,
  TicketSummaryInput,
  EpicSummaryInput,
  SummaryEngineOptions,
} from './cli/logic/summary-engine.js';

// Utils - Git Platform Detection
export type { GitPlatform, DetectPlatformOptions } from './utils/git-platform.js';
export { detectGitPlatform, parsePlatformFromUrl, getGitRemoteUrl } from './utils/git-platform.js';

// Utils - Code Host Adapters
export { createGitHubAdapter } from './utils/code-host-github.js';
export type { GitHubAdapterOptions } from './utils/code-host-github.js';
export { parseGitHubPrUrl } from './utils/code-host-github.js';
export { createGitLabAdapter } from './utils/code-host-gitlab.js';
export type { GitLabAdapterOptions } from './utils/code-host-gitlab.js';
export { parseGitLabMrUrl } from './utils/code-host-gitlab.js';
export { createCodeHostAdapter } from './utils/code-host-factory.js';

// Utils - Claude Executor
export { createClaudeExecutor } from './utils/claude-executor.js';
export type { ClaudeExecutor, ClaudeExecutorOptions } from './utils/claude-executor.js';

// Jira Integration
export { createJiraExecutor, JiraScriptError, JiraTimeoutError, JiraValidationError } from './jira/index.js';
export type {
  JiraExecutor,
  JiraExecutorOptions,
  JiraTicketData,
  JiraSearchResult,
  JiraTransitionResult,
  JiraAssignResult,
  JiraCommentResult,
  GetTicketInput,
  SearchTicketsInput,
  TransitionTicketInput,
  AssignTicketInput,
  AddCommentInput,
} from './jira/index.js';
export {
  getTicketInputSchema,
  searchTicketsInputSchema,
  transitionTicketInputSchema,
  assignTicketInputSchema,
  addCommentInputSchema,
  jiraTicketDataSchema,
  jiraSearchResultSchema,
  jiraTransitionResultSchema,
  jiraAssignResultSchema,
  jiraCommentResultSchema,
} from './jira/index.js';
