import { Terminal } from 'lucide-react';
import { formatTimestampLong } from '../../utils/session-formatters.js';
import type { SystemGroup } from '../../types/groups.js';

interface Props {
  systemGroup: SystemGroup;
}

export function SystemChatGroup({ systemGroup }: Props) {
  const { commandOutput, timestamp } = systemGroup;
  const cleaned = commandOutput.replace(/\x1B\[[0-9;]*m/g, '');
  if (!cleaned.trim()) return null;

  return (
    <div className="flex items-start gap-2 mb-4 px-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
        <Terminal className="w-4 h-4 text-slate-500" />
      </div>
      <div className="flex-1 min-w-0 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <pre className="text-xs text-slate-600 font-mono whitespace-pre-wrap overflow-x-auto">{cleaned}</pre>
        <div className="text-xs text-slate-400 mt-1">{formatTimestampLong(timestamp)}</div>
      </div>
    </div>
  );
}
