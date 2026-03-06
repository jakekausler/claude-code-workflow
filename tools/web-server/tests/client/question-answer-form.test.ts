import { describe, it, expect } from 'vitest';
import type { QuestionAnswerFormProps } from '../../src/client/components/interaction/QuestionAnswerForm.js';

describe('QuestionAnswerForm', () => {
  it('exports QuestionAnswerFormProps type', () => {
    const props: QuestionAnswerFormProps = {
      stageId: 'STAGE-001',
      requestId: 'req-002',
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [
            { label: 'Postgres', description: 'Relational' },
            { label: 'MongoDB', description: 'Document' },
          ],
          multiSelect: false,
        },
      ],
      onClose: () => {},
    };
    expect(props.questions).toHaveLength(1);
  });
});
