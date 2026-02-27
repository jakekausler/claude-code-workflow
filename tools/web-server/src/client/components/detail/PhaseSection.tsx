import { ChevronRight, CheckCircle2, Circle } from 'lucide-react';
import { MarkdownContent } from './MarkdownContent.js';

interface PhaseSectionProps {
  title: string;
  content: string;
  isComplete: boolean;
  defaultExpanded?: boolean;
}

export function PhaseSection({
  title,
  content,
  isComplete,
  defaultExpanded = false,
}: PhaseSectionProps) {
  return (
    <details
      open={defaultExpanded || undefined}
      className="group rounded-lg border border-slate-200 bg-white"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-slate-900 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={16}
          className="text-slate-400 transition-transform group-open:rotate-90"
        />
        {isComplete ? (
          <CheckCircle2 size={16} className="text-green-500" />
        ) : (
          <Circle size={16} className="text-slate-300" />
        )}
        <span>{title}</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-3">
        {content ? (
          <MarkdownContent content={content} />
        ) : (
          <p className="text-sm italic text-slate-400">
            Content available in future update
          </p>
        )}
      </div>
    </details>
  );
}
