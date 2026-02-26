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
      this.emit('question-requested', entry);
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
      this.emit('approval-requested', entry);
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
    this.pending.delete(requestId);

    return decision === 'allow'
      ? { behavior: 'allow' }
      : { behavior: 'deny', message: reason };
  }

  resolveQuestion(
    requestId: string,
    answers: Record<string, string>,
  ): PermissionResult {
    const entry = this.pending.get(requestId);
    if (!entry) throw new Error('Unknown approval request');
    this.pending.delete(requestId);

    return {
      behavior: 'allow',
      updatedInput: { ...(entry.input as object), answers },
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
    for (const [id, entry] of this.pending) {
      if (entry.stageId === stageId) this.pending.delete(id);
    }
  }
}
