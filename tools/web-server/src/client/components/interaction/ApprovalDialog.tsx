import { useState, useCallback } from 'react';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { useApproveToolCall } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

export interface ApprovalDialogProps {
  stageId: string;
  requestId: string;
  toolName: string;
  input: unknown;
  onClose: () => void;
}

export function ApprovalDialog({ stageId, requestId, toolName, input, onClose }: ApprovalDialogProps) {
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const approveMutation = useApproveToolCall(stageId);
  const removeApproval = useInteractionStore((s) => s.removeApproval);

  const handleAllow = useCallback(() => {
    approveMutation.mutate({ requestId, decision: 'allow' });
    removeApproval(requestId);
    onClose();
  }, [requestId, approveMutation, removeApproval, onClose]);

  const handleDeny = useCallback(() => {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    approveMutation.mutate({ requestId, decision: 'deny', reason: reason || undefined });
    removeApproval(requestId);
    onClose();
  }, [requestId, reason, showReason, approveMutation, removeApproval, onClose]);

  const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="border-b border-zinc-700 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">Tool Approval Required</h3>
          <p className="mt-1 text-xs text-zinc-400">Stage: {stageId}</p>
        </div>

        <div className="px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded bg-zinc-700 px-2 py-0.5 text-xs font-mono text-zinc-200">
              {toolName}
            </span>
          </div>
          <pre className="max-h-60 overflow-auto rounded bg-zinc-800 p-3 text-xs text-zinc-300">
            {inputStr}
          </pre>

          {showReason && (
            <div className="mt-3">
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for denial (optional)"
                className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleDeny}
            disabled={approveMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-red-700 px-3 py-1.5 text-sm text-white hover:bg-red-600 disabled:opacity-50"
          >
            <ShieldX size={14} />
            Deny
          </button>
          <button
            onClick={handleAllow}
            disabled={approveMutation.isPending}
            className="flex items-center gap-1.5 rounded bg-green-700 px-3 py-1.5 text-sm text-white hover:bg-green-600 disabled:opacity-50"
          >
            <ShieldCheck size={14} />
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
