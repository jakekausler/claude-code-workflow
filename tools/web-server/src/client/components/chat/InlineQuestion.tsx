import { useState, useCallback } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { useAnswerQuestion } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

export interface InlineQuestionProps {
  stageId: string;
  question: { requestId: string; question: string; options?: string[] };
  onResolved: () => void;
}

export function InlineQuestion({ stageId, question, onResolved }: InlineQuestionProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const answerMutation = useAnswerQuestion(stageId);
  const removeQuestion = useInteractionStore((s) => s.removeQuestion);

  const answer = question.options ? selected : freeText.trim();

  const handleSubmit = useCallback(() => {
    if (!answer) return;
    answerMutation.mutate(
      { requestId: question.requestId, answers: { [question.question]: answer } },
      {
        onSuccess: () => {
          removeQuestion(question.requestId);
          onResolved();
        },
      },
    );
  }, [question.requestId, question.question, answer, answerMutation, removeQuestion, onResolved]);

  return (
    <div className="rounded-md border border-blue-300 bg-blue-50 p-3">
      <div className="flex items-center gap-2">
        <MessageCircle size={16} className="flex-shrink-0 text-blue-600" />
        <span className="text-sm font-semibold text-slate-900">Question from Claude</span>
      </div>

      <p className="mt-2 text-sm text-slate-700">{question.question}</p>

      {question.options ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {question.options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setSelected(opt)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                selected === opt
                  ? 'border-blue-500 bg-blue-200 text-blue-800'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-blue-300'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <input
          type="text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && answer) handleSubmit();
          }}
          placeholder="Type your answer..."
          className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          autoFocus
        />
      )}

      <div className="mt-2 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!answer || answerMutation.isPending}
          className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          <Send size={12} />
          Submit
        </button>
      </div>
    </div>
  );
}
