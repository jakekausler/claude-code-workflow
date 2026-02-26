import { useState, useCallback } from 'react';
import { MessageSquare, Check } from 'lucide-react';
import { useAnswerQuestion } from '../../api/interaction-hooks.js';
import { useInteractionStore } from '../../store/interaction-store.js';

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionDef {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionAnswerFormProps {
  stageId: string;
  requestId: string;
  questions: QuestionDef[];
  onClose: () => void;
}

export function QuestionAnswerForm({ stageId, requestId, questions, onClose }: QuestionAnswerFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  const answerMutation = useAnswerQuestion(stageId);
  const removeQuestion = useInteractionStore((s) => s.removeQuestion);

  const handleOptionSelect = useCallback((questionText: string, label: string) => {
    setAnswers((prev) => ({ ...prev, [questionText]: label }));
  }, []);

  const handleOtherChange = useCallback((questionText: string, value: string) => {
    setOtherInputs((prev) => ({ ...prev, [questionText]: value }));
    setAnswers((prev) => ({ ...prev, [questionText]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    answerMutation.mutate({ requestId, answers });
    removeQuestion(requestId);
    onClose();
  }, [requestId, answers, answerMutation, removeQuestion, onClose]);

  const allAnswered = questions.every((q) => answers[q.question]?.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="border-b border-zinc-700 px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <MessageSquare size={16} />
            Question from Claude
          </h3>
          <p className="mt-1 text-xs text-zinc-400">Stage: {stageId}</p>
        </div>

        <div className="max-h-96 overflow-auto px-4 py-3 space-y-4">
          {questions.map((q) => (
            <div key={q.question}>
              {q.header && (
                <span className="mb-1 inline-block rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                  {q.header}
                </span>
              )}
              <p className="mb-2 text-sm text-zinc-200">{q.question}</p>

              {q.options && (
                <div className="space-y-1.5">
                  {q.options.map((opt) => (
                    <button
                      key={opt.label}
                      onClick={() => handleOptionSelect(q.question, opt.label)}
                      className={`flex w-full items-start gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                        answers[q.question] === opt.label
                          ? 'border-blue-500 bg-blue-900/30 text-blue-200'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      <span className="mt-0.5 flex-shrink-0">
                        {answers[q.question] === opt.label ? (
                          <Check size={14} className="text-blue-400" />
                        ) : (
                          <div className="h-3.5 w-3.5 rounded-full border border-zinc-600" />
                        )}
                      </span>
                      <div>
                        <span className="font-medium">{opt.label}</span>
                        {opt.description && (
                          <p className="mt-0.5 text-xs text-zinc-400">{opt.description}</p>
                        )}
                      </div>
                    </button>
                  ))}

                  {/* "Other" free-text option */}
                  <div
                    className={`rounded border px-3 py-2 ${
                      otherInputs[q.question] !== undefined && answers[q.question] === otherInputs[q.question]
                        ? 'border-blue-500 bg-blue-900/30'
                        : 'border-zinc-700 bg-zinc-800'
                    }`}
                  >
                    <input
                      type="text"
                      value={otherInputs[q.question] ?? ''}
                      onChange={(e) => handleOtherChange(q.question, e.target.value)}
                      onFocus={() => handleOtherChange(q.question, otherInputs[q.question] ?? '')}
                      placeholder="Other..."
                      className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Text-only question (no options) */}
              {!q.options && (
                <input
                  type="text"
                  value={answers[q.question] ?? ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  placeholder="Type your answer..."
                  className="w-full rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none"
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={handleSubmit}
            disabled={!allAnswered || answerMutation.isPending}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
          >
            Submit Answers
          </button>
        </div>
      </div>
    </div>
  );
}
