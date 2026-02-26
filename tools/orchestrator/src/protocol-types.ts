// ─── Outbound messages (to Claude Code stdin) ─────────────────────

/** Send a follow-up user message to Claude */
export interface UserMessage {
  type: 'user';
  message: { role: 'user'; content: string };
}

/** Send a control request (initialize, interrupt, set_permission_mode) */
export interface ControlRequest {
  type: 'control_request';
  request_id: string;
  request:
    | { subtype: 'initialize'; hooks?: unknown }
    | { subtype: 'interrupt' }
    | { subtype: 'set_permission_mode'; mode: string };
}

/** Respond to a control request from Claude (tool approval) */
export interface ControlResponse {
  type: 'control_response';
  response: {
    subtype: 'success';
    request_id: string;
    response: PermissionResult;
  };
}

export type OutboundMessage = UserMessage | ControlRequest | ControlResponse;

// ─── Inbound messages (from Claude Code stdout) ───────────────────

/** Claude requests tool approval */
export interface CanUseToolRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    input: unknown;
    tool_use_id?: string;
    permission_suggestions?: unknown[];
    blocked_paths?: string | null;
  };
}

/** Claude requests hook callback */
export interface HookCallbackRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'hook_callback';
    callback_id: string;
    input: unknown;
    tool_use_id?: string;
  };
}

/** Claude cancels a pending approval request */
export interface ControlCancelRequest {
  type: 'control_cancel_request';
  request_id: string;
}

/** Session complete */
export interface ResultMessage {
  type: 'result';
  result: unknown;
}

export type InboundControlRequest = CanUseToolRequest | HookCallbackRequest;

export type InboundMessage =
  | InboundControlRequest
  | ControlCancelRequest
  | ResultMessage;

// ─── Permission result ────────────────────────────────────────────

export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message?: string };

// ─── Approval / question / queue state ────────────────────────────

export interface PendingApproval {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PendingQuestion {
  stageId: string;
  requestId: string;
  questions: unknown[];
  input: unknown;
  createdAt: number;
}

export interface QueuedMessage {
  message: string;
  queuedAt: number;
}

// ─── Protocol handler interface ───────────────────────────────────

export interface ProtocolHandler {
  handleControlRequest(
    requestId: string,
    request: InboundControlRequest['request'],
  ): Promise<void>;
  handleCancelRequest(requestId: string): void;
  handleResult(msg: ResultMessage): void;
}
