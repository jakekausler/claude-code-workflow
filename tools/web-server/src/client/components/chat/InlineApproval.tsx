import { useState, useCallback } from 'react';
import { Shield, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useApproveToolCall } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

export interface InlineApprovalProps {
  stageId: string;
  approval: { requestId: string; toolName: string; toolInput: Record<string, unknown> };
  onResolved: () => void;
}

export function InlineApproval({ stageId, approval, onResolved }: InlineApprovalProps) {
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const approveMutation = useApproveToolCall(stageId);
  const removeApproval = useInteractionStore((s) => s.removeApproval);

  const inputStr =
    typeof approval.toolInput === 'string'
      ? approval.toolInput
      : JSON.stringify(approval.toolInput, null, 2);

  const truncated = inputStr.length > 200;
  const preview = truncated ? inputStr.slice(0, 200) + '...' : inputStr;

  const handleAllow = useCallback(() => {
    approveMutation.mutate(
      { requestId: approval.requestId, decision: 'allow' },
      {
        onSuccess: () => {
          removeApproval(approval.requestId);
          onResolved();
        },
      },
    );
  }, [approval.requestId, approveMutation, removeApproval, onResolved]);

  const handleDeny = useCallback(() => {
    if (!showReason) {
      setShowReason(true);
      return;
    }
    approveMutation.mutate(
      { requestId: approval.requestId, decision: 'deny', reason: reason || undefined },
      {
        onSuccess: () => {
          removeApproval(approval.requestId);
          onResolved();
        },
      },
    );
  }, [approval.requestId, reason, showReason, approveMutation, removeApproval, onResolved]);

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-center gap-2">
        <Shield size={16} className="flex-shrink-0 text-amber-600" />
        <span className="text-sm font-semibold text-slate-900">Tool Permission Required</span>
        <span className="ml-auto rounded bg-amber-200 px-2 py-0.5 font-mono text-xs text-slate-700">
          {approval.toolName}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="mt-2 flex w-full items-start gap-1 text-left"
      >
        <pre className="flex-1 overflow-hidden whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-600">
          {expanded ? inputStr : preview}
        </pre>
        {truncated && (
          <span className="mt-1 flex-shrink-0 text-slate-400">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        )}
      </button>

      {showReason && (
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for denial (optional)"
          className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 placeholder:text-slate-400 focus:border-red-400 focus:outline-none"
          autoFocus
        />
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button
          onClick={handleDeny}
          disabled={approveMutation.isPending}
          className="flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          <X size={12} />
          Deny
        </button>
        <button
          onClick={handleAllow}
          disabled={approveMutation.isPending}
          className="flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
        >
          <Check size={12} />
          Allow
        </button>
      </div>
    </div>
  );
}
