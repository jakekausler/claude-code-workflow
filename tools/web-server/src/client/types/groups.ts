import type { ParsedMessage, SemanticStep, Process, SessionMetrics, UsageMetadata } from './session.js';

// ChatItem discriminated union
export type ChatItem =
  | { type: 'user'; group: UserGroup }
  | { type: 'system'; group: SystemGroup }
  | { type: 'ai'; group: AIGroup }
  | { type: 'compact'; group: CompactGroup };

export interface SessionConversation {
  sessionId: string;
  items: ChatItem[];
  totalUserGroups: number;
  totalSystemGroups: number;
  totalAIGroups: number;
  totalCompactGroups: number;
  totalPhases: number;
}

export interface UserGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  content: UserGroupContent;
  index: number;
}

export interface UserGroupContent {
  text?: string;
  rawText?: string;
  commands: CommandInfo[];
  images: ImageData[];
  fileReferences: FileReference[];
}

export interface CommandInfo {
  name: string;
  args?: string;
  message?: string;
}

export interface ImageData {
  mediaType: string;
}

export interface FileReference {
  path: string;
}

export interface SystemGroup {
  id: string;
  message: ParsedMessage;
  timestamp: Date;
  commandOutput: string;
}

export type AIGroupStatus = 'complete' | 'in_progress' | 'interrupted' | 'error';

export interface AIGroup {
  id: string;
  turnIndex: number;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  steps: SemanticStep[];
  tokens: AIGroupTokens;
  summary: AIGroupSummary;
  status: AIGroupStatus;
  processes: Process[];
  chunkId: string;
  responses: ParsedMessage[];
  isOngoing?: boolean;
  phaseNumber?: number;
}

export interface AIGroupSummary {
  thinkingPreview?: string;
  toolCallCount: number;
  outputMessageCount: number;
  subagentCount: number;
  totalDurationMs: number;
  totalTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AIGroupTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface CompactGroup {
  id: string;
  timestamp: Date;
  summary: string;
  message: ParsedMessage;
  tokenDelta?: CompactionTokenDelta;
  startingPhaseNumber?: number;
}

export interface CompactionTokenDelta {
  preCompactionTokens: number;
  postCompactionTokens: number;
  delta: number;
}

export interface EnhancedAIGroup extends AIGroup {
  lastOutput: AIGroupLastOutput | null;
  displayItems: AIGroupDisplayItem[];
  linkedTools: Map<string, LinkedToolItemData>;
  itemsSummary: string;
  mainModel: ModelInfo | null;
  subagentModels: ModelInfo[];
  claudeMdStats: { paths: string[]; totalTokens: number } | null;
}

export interface AIGroupLastOutput {
  type: 'text' | 'tool_result' | 'interruption' | 'ongoing' | 'plan_exit';
  text?: string;
  toolName?: string;
  toolResult?: string;
  isError?: boolean;
  interruptionMessage?: string;
  planContent?: string;
  planPreamble?: string;
  timestamp: Date;
}

export interface LinkedToolItemData {
  id: string;
  name: string;
  input: Record<string, unknown>;
  callTokens?: number;
  result?: {
    content: string | unknown[];
    isError: boolean;
    toolUseResult?: { status: string; [key: string]: unknown };
    tokenCount?: number;
  };
  inputPreview: string;
  outputPreview?: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  isOrphaned: boolean;
  sourceModel?: string;
  skillInstructions?: string;
  skillInstructionsTokenCount?: number;
}

export type AIGroupDisplayItem =
  | { type: 'thinking'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'tool'; tool: LinkedToolItemData }
  | { type: 'subagent'; subagent: Process }
  | { type: 'output'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'slash'; slash: SlashItem }
  | { type: 'teammate_message'; teammateMessage: TeammateMessage }
  | { type: 'subagent_input'; content: string; timestamp: Date; tokenCount?: number }
  | { type: 'compact_boundary'; content: string; timestamp: Date; tokenDelta?: CompactionTokenDelta; phaseNumber: number };

export interface SlashItem {
  id: string;
  name: string;
  message?: string;
  args?: string;
  commandMessageUuid?: string;
  instructions?: string;
  instructionsTokenCount?: number;
  timestamp: Date;
}

export interface TeammateMessage {
  teammateId: string;
  color?: string;
  summary?: string;
  content: string;
  timestamp: Date;
}

export type ModelFamily = 'sonnet' | 'opus' | 'haiku' | string;

export interface ModelInfo {
  name: string;
  family: ModelFamily;
  majorVersion: number;
  minorVersion: number | null;
}

export interface MainSessionImpact {
  callTokens: number;
  resultTokens: number;
  totalTokens: number;
}
