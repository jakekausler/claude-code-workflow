import { describe, it, expect } from 'vitest';
import { findLastOutput } from '../../src/client/utils/last-output-detector.js';
import type { SemanticStep } from '../../src/server/types/jsonl.js';

function makeStep(overrides: Partial<SemanticStep> = {}): SemanticStep {
  return {
    type: 'output',
    content: '',
    ...overrides,
  };
}

describe('findLastOutput', () => {
  it('returns null for empty steps', () => {
    expect(findLastOutput([])).toBeNull();
  });

  it('returns interruption when present (priority 1)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'some output' }),
      makeStep({ type: 'interruption', content: 'User cancelled' }),
    ];
    const result = findLastOutput(steps);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('interruption');
    expect(result!.interruptionMessage).toBe('User cancelled');
  });

  it('interruption takes priority over ongoing', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'interruption', content: 'Stopped' }),
    ];
    const result = findLastOutput(steps, true);
    expect(result!.type).toBe('interruption');
  });

  it('returns ongoing when flag is true and no interruption (priority 2)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'some output' }),
    ];
    const result = findLastOutput(steps, true);
    expect(result!.type).toBe('ongoing');
  });

  it('returns plan_exit for ExitPlanMode with no later output (priority 3)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'Here is the plan:' }),
      makeStep({
        type: 'tool_call',
        toolName: 'ExitPlanMode',
        toolCallId: 'tc-plan',
        content: 'Plan content here',
      }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('plan_exit');
    expect(result!.planContent).toBe('Plan content here');
    expect(result!.planPreamble).toBe('Here is the plan:');
  });

  it('plan_exit is NOT returned when there is later output', () => {
    const steps: SemanticStep[] = [
      makeStep({
        type: 'tool_call',
        toolName: 'ExitPlanMode',
        toolCallId: 'tc-plan',
        content: 'Plan',
      }),
      makeStep({ type: 'output', content: 'Additional message' }),
    ];
    const result = findLastOutput(steps);
    // Should be text output, not plan_exit
    expect(result!.type).toBe('text');
    expect(result!.text).toBe('Additional message');
  });

  it('plan_exit extracts preamble from preceding output step', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'thinking...' }),
      makeStep({ type: 'output', content: 'Preamble text' }),
      makeStep({
        type: 'tool_call',
        toolName: 'ExitPlanMode',
        toolCallId: 'tc-plan',
        content: 'The plan',
      }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('plan_exit');
    expect(result!.planPreamble).toBe('Preamble text');
  });

  it('plan_exit with no preceding output has undefined preamble', () => {
    const steps: SemanticStep[] = [
      makeStep({
        type: 'tool_call',
        toolName: 'ExitPlanMode',
        toolCallId: 'tc-plan',
        content: 'The plan',
      }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('plan_exit');
    expect(result!.planPreamble).toBeUndefined();
  });

  it('returns text for last output step (priority 4)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'reasoning' }),
      makeStep({ type: 'output', content: 'First output' }),
      makeStep({ type: 'output', content: 'Last output' }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('text');
    expect(result!.text).toBe('Last output');
  });

  it('returns tool_result for last tool result step (priority 5)', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'thinking' }),
      makeStep({
        type: 'tool_result',
        toolName: 'Read',
        content: 'file content',
        isError: false,
      }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('tool_result');
    expect(result!.toolName).toBe('Read');
    expect(result!.toolResult).toBe('file content');
    expect(result!.isError).toBe(false);
  });

  it('tool_result with isError flag', () => {
    const steps: SemanticStep[] = [
      makeStep({
        type: 'tool_result',
        toolName: 'Bash',
        content: 'Permission denied',
        isError: true,
      }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('tool_result');
    expect(result!.isError).toBe(true);
  });

  it('text output takes priority over tool_result', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'tool_result', toolName: 'Read', content: 'data' }),
      makeStep({ type: 'output', content: 'Here is the result' }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('text');
    expect(result!.text).toBe('Here is the result');
  });

  it('skips empty output steps', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: '' }),
      makeStep({ type: 'tool_result', toolName: 'Read', content: 'data' }),
    ];
    const result = findLastOutput(steps);
    expect(result!.type).toBe('tool_result');
  });

  it('returns null when only thinking steps present', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'thinking', content: 'pondering...' }),
    ];
    expect(findLastOutput(steps)).toBeNull();
  });

  it('includes timestamp on all return types', () => {
    const steps: SemanticStep[] = [
      makeStep({ type: 'output', content: 'hello' }),
    ];
    const result = findLastOutput(steps);
    expect(result!.timestamp).toBeInstanceOf(Date);
  });
});
