import { EventEmitter } from 'node:events';
import type {
  ProtocolHandler,
  InboundControlRequest,
  ResultMessage,
  PermissionResult,
  PendingApproval,
  PendingQuestion,
} from './protocol-types.js';

type PendingEntry = (PendingApproval | PendingQuestion) & { type: 'approval' | 'question' };

/**
 * Tool names that the orchestrator intercepts as signals rather than real tools.
 * When Claude "calls" one of these, the orchestrator emits a session-signal event
 * and immediately denies the tool call with an acknowledgement message.
 */
export const SIGNAL_TOOL_NAMES = ['conversion_complete', 'transition_stage'] as const;
export type SignalToolName = (typeof SIGNAL_TOOL_NAMES)[number];

export interface SessionSignal {
  stageId: string;
  signalName: SignalToolName;
  input: unknown;
  requestId: string;
}

export interface ApprovalServiceEvents {
  'approval-requested': (entry: PendingApproval & { type: 'approval' }) => void;
  'question-requested': (entry: PendingQuestion & { type: 'question' }) => void;
  'approval-cancelled': (requestId: string) => void;
  'result': (msg: ResultMessage) => void;
  'session-signal': (signal: SessionSignal) => void;
}

export declare interface ApprovalService {
  on<K extends keyof ApprovalServiceEvents>(event: K, listener: ApprovalServiceEvents[K]): this;
  emit<K extends keyof ApprovalServiceEvents>(event: K, ...args: Parameters<ApprovalServiceEvents[K]>): boolean;
}

/**
 * Manages pending tool approval requests and AskUserQuestion prompts.
 *
 * Implements ProtocolHandler so it can be plugged directly into ProtocolPeer.
 * When Claude requests tool permission, the service queues the request and
 * emits an event for the WebSocket/SSE layer to broadcast to connected clients.
 *
 * Events emitted:
 *  - 'approval-requested' (PendingApproval)
 *  - 'question-requested' (PendingQuestion)
 *  - 'approval-cancelled' (requestId: string)
 *  - 'result' (ResultMessage)
 */
export class ApprovalService extends EventEmitter implements ProtocolHandler {
  private pending = new Map<string, PendingEntry>();
  private currentStageId = '';

  setCurrentStageId(stageId: string): void {
    this.currentStageId = stageId;
  }

  // ── ProtocolHandler implementation ──────────────────────────

  async handleControlRequest(
    requestId: string,
    request: InboundControlRequest['request'],
  ): Promise<void> {
    if (request.subtype !== 'can_use_tool') return;

    // Intercept orchestrator signal tools — these are not real tools.
    // Emit a signal event and let the session layer send the response.
    if ((SIGNAL_TOOL_NAMES as readonly string[]).includes(request.tool_name)) {
      this.emit('session-signal', {
        stageId: this.currentStageId,
        signalName: request.tool_name as SignalToolName,
        input: request.input,
        requestId,
      });
      return;
    }

    const isQuestion = request.tool_name === 'AskUserQuestion';

    if (isQuestion) {
      const questions = (request.input as Record<string, unknown>)?.questions as unknown[] ?? [];
      const entry: PendingEntry = {
        type: 'question',
        stageId: this.currentStageId,
        requestId,
        questions,
        input: request.input,
        createdAt: Date.now(),
      };
      this.pending.set(requestId, entry);
      this.emit('question-requested', entry as PendingQuestion & { type: 'question' });
    } else {
      const entry: PendingEntry = {
        type: 'approval',
        stageId: this.currentStageId,
        requestId,
        toolName: request.tool_name,
        input: request.input,
        createdAt: Date.now(),
      };
      this.pending.set(requestId, entry);
      this.emit('approval-requested', entry as PendingApproval & { type: 'approval' });
    }
  }

  handleCancelRequest(requestId: string): void {
    if (this.pending.has(requestId)) {
      this.pending.delete(requestId);
      this.emit('approval-cancelled', requestId);
    }
  }

  handleResult(msg: ResultMessage): void {
    this.emit('result', msg);
  }

  // ── Resolution methods (called when web UI responds) ────────

  resolveApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    reason?: string,
  ): PermissionResult {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error('Unknown approval request');
    if (entry.type !== 'approval') throw new Error('Request is not a tool approval');
    this.pending.delete(requestId);

    return decision === 'allow'
      ? { behavior: 'allow', updatedInput: {} }
      : { behavior: 'deny', message: reason ?? 'Denied by user' };
  }

  resolveQuestion(
    requestId: string,
    answers: Record<string, string>,
  ): PermissionResult {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error('Unknown approval request');
    if (entry.type !== 'question') throw new Error('Request is not a question');
    this.pending.delete(requestId);

    const originalInput = entry.input != null && typeof entry.input === 'object' ? entry.input : {};
    return {
      behavior: 'allow',
      updatedInput: { ...originalInput, answers },
    };
  }

  // ── Query methods ───────────────────────────────────────────

  getPending(): Array<PendingApproval | PendingQuestion> {
    return [...this.pending.values()];
  }

  getPendingForStage(stageId: string): Array<PendingApproval | PendingQuestion> {
    return [...this.pending.values()].filter((e) => e.stageId === stageId);
  }

  clearForStage(stageId: string): void {
    // Safe to delete during Map iteration per ES6 spec (visited entries won't be revisited)
    for (const [id, entry] of this.pending) {
      if (entry.stageId === stageId) this.pending.delete(id);
    }
  }
}
