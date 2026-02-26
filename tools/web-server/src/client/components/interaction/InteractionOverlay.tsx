import { useCallback } from 'react';
import { useInteractionStore } from '../../store/interaction-store.js';
import { ApprovalDialog } from './ApprovalDialog.js';
import { QuestionAnswerForm } from './QuestionAnswerForm.js';
import type { QuestionDef } from '../../store/interaction-store.js';

/**
 * Renders approval/question modals from the interaction store.
 * Mounted at App root to catch events regardless of current page.
 * Shows the first pending item; once resolved, the next appears.
 */
export function InteractionOverlay() {
  const approvals = useInteractionStore((s) => s.pendingApprovals);
  const questions = useInteractionStore((s) => s.pendingQuestions);

  const firstApproval = approvals[0];
  const firstQuestion = questions[0];

  const noop = useCallback(() => {}, []);

  // Approvals take priority over questions
  if (firstApproval) {
    return (
      <ApprovalDialog
        stageId={firstApproval.stageId}
        requestId={firstApproval.requestId}
        toolName={firstApproval.toolName}
        input={firstApproval.input}
        onClose={noop}
      />
    );
  }

  if (firstQuestion) {
    return (
      <QuestionAnswerForm
        stageId={firstQuestion.stageId}
        requestId={firstQuestion.requestId}
        questions={firstQuestion.questions}
        onClose={noop}
      />
    );
  }

  return null;
}
