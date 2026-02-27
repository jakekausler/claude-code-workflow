// ─── 1. Entry types ──────────────────────────────────────────────────────────

export type EntryType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'file-history-snapshot'
  | 'queue-operation';

// ─── 2. Content block types ──────────────────────────────────────────────────

export type ContentType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ThinkingContent {
  type: 'thinking';
  thinking: string;
  signature: string;
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  /** In practice, nested content is typically string or TextContent[]/ImageContent[], not deeply recursive */
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
}

export type ContentBlock =
  | TextContent
  | ThinkingContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

// ─── 3. Stop reason and usage ────────────────────────────────────────────────

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;

export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
  server_tool_use?: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
  service_tier?: string;
}

// ─── 4. JSONL Entry interfaces ───────────────────────────────────────────────

export interface ConversationalEntry {
  type: 'user' | 'assistant' | 'system';
  parentUuid: string | null;
  isSidechain: boolean;
  userType: 'external';
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  slug?: string;
  timestamp?: string;
  uuid?: string;
}

export interface UserEntry extends ConversationalEntry {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  isMeta?: boolean;
  agentId?: string;
  toolUseResult?: Record<string, unknown>;
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  todos?: unknown[];
  permissionMode?: string;
}

export interface AssistantEntry extends ConversationalEntry {
  type: 'assistant';
  message: {
    model: string;
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    stop_reason: StopReason;
    stop_sequence: string | null;
    usage: UsageMetadata;
  };
  requestId: string;
  agentId?: string;
}

export interface SystemEntry extends ConversationalEntry {
  type: 'system';
  subtype: 'turn_duration' | 'init';
  durationMs: number;
  isMeta: boolean;
}

export interface SummaryEntry {
  type: 'summary';
  summary: string;
  leafUuid: string;
  timestamp?: string;
  uuid?: string;
}

export interface FileHistorySnapshotEntry {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, string>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export interface QueueOperationEntry {
  type: 'queue-operation';
  operation: string;
  timestamp?: string;
  sessionId?: string;
  content?: string;
}

export type JournalEntry =
  | UserEntry
  | AssistantEntry
  | SystemEntry
  | SummaryEntry
  | FileHistorySnapshotEntry
  | QueueOperationEntry;

// ─── 5. Parsed types (application internal) ──────────────────────────────────

export interface ParsedMessage {
  uuid: string;
  parentUuid: string | null;
  type: EntryType;
  timestamp: Date;
  role?: string;
  content: ContentBlock[] | string;
  usage?: UsageMetadata;
  model?: string;
  cwd?: string;
  gitBranch?: string;
  agentId?: string;
  isSidechain: boolean;
  isMeta: boolean;
  userType?: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  sourceToolUseID?: string;
  sourceToolAssistantUUID?: string;
  toolUseResult?: Record<string, unknown>;
  isCompactSummary?: boolean;
  requestId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  isTask: boolean;
  taskDescription?: string;
  taskSubagentType?: string;
}

export interface ToolResult {
  toolUseId: string;
  content: string | unknown[];
  isError: boolean;
}

// ─── 6. Message classification and chunk types ───────────────────────────────

export type MessageCategory = 'user' | 'system' | 'hardNoise' | 'ai';

export interface UserChunk {
  type: 'user';
  id: string;
  message: ParsedMessage;
  timestamp: Date;
}

export interface AIChunk {
  type: 'ai';
  id: string;
  messages: ParsedMessage[];
  timestamp: Date;
}

export interface SystemChunk {
  type: 'system';
  id: string;
  messages: ParsedMessage[];
  timestamp: Date;
}

export interface CompactChunk {
  type: 'compact';
  id: string;
  summary: string;
  timestamp: Date;
}

export type Chunk = UserChunk | AIChunk | SystemChunk | CompactChunk;

// ─── 7. Semantic step types ──────────────────────────────────────────────────

export type SemanticStepType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'subagent'
  | 'output';

export interface SemanticStep {
  type: SemanticStepType;
  content: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  durationMs?: number;
  subagentId?: string;
}

// ─── 8. Enhanced AI chunk ────────────────────────────────────────────────────

export interface EnhancedAIChunk extends AIChunk {
  semanticSteps: SemanticStep[];
  subagents: Process[];
}

// ─── 9. Tool execution ──────────────────────────────────────────────────────

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: ToolResult;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  isOrphaned: boolean;
}

// ─── 10. Process (subagent) ──────────────────────────────────────────────────

export interface Process {
  id: string;
  filePath: string;
  messages: ParsedMessage[];
  startTime: Date;
  endTime: Date;
  durationMs: number;
  metrics: SessionMetrics;
  description?: string;
  subagentType?: string;
  isParallel: boolean;
  parentTaskId?: string;
  isOngoing?: boolean;
  team?: {
    teamName: string;
    memberName: string;
    memberColor: string;
  };
  mainSessionImpact?: MainSessionImpact;
}

export interface MainSessionImpact {
  callTokens: number;
  resultTokens: number;
  totalTokens: number;
}

// ─── 11. Session metrics ─────────────────────────────────────────────────────

export interface SessionMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCost: number;
  turnCount: number;
  toolCallCount: number;
  duration: number; // ms
}

// ─── 12. Parsed session ──────────────────────────────────────────────────────

/**
 * Token estimate for a CLAUDE.md file discovered on disk.
 * Used to attribute CLAUDE.md context that Claude Code injects at API time
 * but does NOT store in the session JSONL.
 */
export interface ClaudeMdFileEstimate {
  path: string;
  estimatedTokens: number;
}

/**
 * Token estimate for an @-mentioned file read from disk.
 * Used to provide accurate token counts for mentioned files instead of
 * estimating from the file path string alone.
 */
export interface MentionedFileEstimate {
  path: string;
  estimatedTokens: number;
}

export interface ParsedSession {
  chunks: Chunk[];
  metrics: SessionMetrics;
  subagents: Process[];
  isOngoing: boolean;
  /** CLAUDE.md files discovered on disk with token estimates. */
  claudeMdFiles?: ClaudeMdFileEstimate[];
  /** @-mentioned files read from disk with token estimates. */
  mentionedFileTokens?: MentionedFileEstimate[];
}

// ─── 13. Context tracking types ──────────────────────────────────────────────

export interface TokensByCategory {
  claudeMd: number;
  mentionedFiles: number;
  toolOutputs: number;
  thinkingText: number;
  taskCoordination: number;
  userMessages: number;
}

export interface ToolTokenBreakdown {
  toolName: string;
  tokenCount: number;
}

export interface ContextItemDetail {
  label: string;
  tokens: number;
}

export interface ThinkingTextBreakdown {
  thinking: number;
  text: number;
}

export interface ContextStats {
  turnIndex: number;
  cumulativeTokens: TokensByCategory;
  turnTokens: TokensByCategory;
  totalTokens: number;
  // Per-item breakdowns for expandable ContextBadge
  claudeMdItems?: ContextItemDetail[];
  mentionedFileItems?: ContextItemDetail[];
  toolOutputItems?: ToolTokenBreakdown[];
  taskCoordinationItems?: ContextItemDetail[];
  thinkingTextDetail?: ThinkingTextBreakdown;
  userMessageItems?: ContextItemDetail[];
}

export interface ContextPhaseInfo {
  phaseIndex: number;
  startTurn: number;
  endTurn: number;
  compactedTokens: number;
  label: string;
}
