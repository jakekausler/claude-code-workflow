import { Zap } from 'lucide-react';
import { extractResultContent } from '../../utils/session-formatters.js';
import type { ToolExecution } from '../../types/session.js';

interface Props {
  execution: ToolExecution;
}

export function SkillRenderer({ execution }: Props) {
  const { input } = execution;
  const skillName = input.skill as string | undefined;
  const args = input.args as string | undefined;

  const output = extractResultContent(execution.result);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center gap-2 text-slate-600">
        <Zap className="w-4 h-4 text-amber-500" />
        <span className="font-medium text-xs">Skill: {skillName || 'unknown'}</span>
        {args && <code className="text-xs font-mono text-slate-400">{args}</code>}
      </div>
      {output && (
        <pre className="bg-slate-50 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
          {output}
        </pre>
      )}
    </div>
  );
}
