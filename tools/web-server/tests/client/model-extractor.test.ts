import { describe, it, expect } from 'vitest';
import { parseModelString, extractMainModel, extractSubagentModels } from '../../src/client/utils/model-extractor.js';
import type { ParsedMessage, Process } from '../../src/server/types/jsonl.js';
import { defaultMetrics, createTestProcess } from './test-helpers.js';

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-1',
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date('2025-01-01'),
    content: [],
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeProcess(overrides: Partial<Process> = {}): Process {
  return createTestProcess({
    ...overrides,
  });
}

describe('parseModelString', () => {
  it('parses new format claude-sonnet-4-5-20250929', () => {
    const result = parseModelString('claude-sonnet-4-5-20250929');
    expect(result).toEqual({
      name: 'sonnet4.5',
      family: 'sonnet',
      majorVersion: 4,
      minorVersion: 5,
    });
  });

  it('parses old format claude-3-5-sonnet-20241022', () => {
    const result = parseModelString('claude-3-5-sonnet-20241022');
    expect(result).toEqual({
      name: 'sonnet3.5',
      family: 'sonnet',
      majorVersion: 3,
      minorVersion: 5,
    });
  });

  it('parses old format without minor version claude-3-opus-20240229', () => {
    const result = parseModelString('claude-3-opus-20240229');
    expect(result).toEqual({
      name: 'opus3',
      family: 'opus',
      majorVersion: 3,
      minorVersion: null,
    });
  });

  it('parses new format claude-opus-4-6-20251234', () => {
    const result = parseModelString('claude-opus-4-6-20251234');
    expect(result).toEqual({
      name: 'opus4.6',
      family: 'opus',
      majorVersion: 4,
      minorVersion: 6,
    });
  });

  it('returns null for <synthetic>', () => {
    expect(parseModelString('<synthetic>')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseModelString('')).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseModelString(undefined)).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(parseModelString('gpt-4-turbo')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseModelString('   ')).toBeNull();
  });
});

describe('extractMainModel', () => {
  it('returns most common model from assistant messages', () => {
    const messages = [
      makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
      makeMsg({ model: 'claude-sonnet-4-5-20250929' }),
      makeMsg({ model: 'claude-opus-4-6-20251234' }),
    ];
    const result = extractMainModel(messages);
    expect(result).toEqual({
      name: 'sonnet4.5',
      family: 'sonnet',
      majorVersion: 4,
      minorVersion: 5,
    });
  });

  it('ignores non-assistant messages', () => {
    const messages = [
      makeMsg({ type: 'user', model: 'claude-opus-4-6-20251234' }),
      makeMsg({ type: 'assistant', model: 'claude-sonnet-4-5-20250929' }),
    ];
    const result = extractMainModel(messages);
    expect(result?.family).toBe('sonnet');
  });

  it('returns null when no assistant messages have model', () => {
    const messages = [
      makeMsg({ type: 'assistant', model: undefined }),
    ];
    expect(extractMainModel(messages)).toBeNull();
  });

  it('returns null for empty messages', () => {
    expect(extractMainModel([])).toBeNull();
  });

  it('handles single assistant message', () => {
    const messages = [
      makeMsg({ model: 'claude-3-5-sonnet-20241022' }),
    ];
    const result = extractMainModel(messages);
    expect(result?.name).toBe('sonnet3.5');
  });
});

describe('extractSubagentModels', () => {
  it('extracts unique subagent models different from main', () => {
    const mainModel = parseModelString('claude-sonnet-4-5-20250929');
    const processes = [
      makeProcess({
        id: 'p1',
        messages: [makeMsg({ model: 'claude-3-5-haiku-20241022' })],
      }),
      makeProcess({
        id: 'p2',
        messages: [makeMsg({ model: 'claude-sonnet-4-5-20250929' })],
      }),
    ];

    const result = extractSubagentModels(processes, mainModel);
    expect(result).toHaveLength(1);
    expect(result[0].family).toBe('haiku');
  });

  it('deduplicates subagent models', () => {
    const mainModel = parseModelString('claude-sonnet-4-5-20250929');
    const processes = [
      makeProcess({
        id: 'p1',
        messages: [makeMsg({ model: 'claude-3-5-haiku-20241022' })],
      }),
      makeProcess({
        id: 'p2',
        messages: [makeMsg({ model: 'claude-3-5-haiku-20241022' })],
      }),
    ];

    const result = extractSubagentModels(processes, mainModel);
    expect(result).toHaveLength(1);
  });

  it('returns empty when all subagents use main model', () => {
    const mainModel = parseModelString('claude-sonnet-4-5-20250929');
    const processes = [
      makeProcess({
        messages: [makeMsg({ model: 'claude-sonnet-4-5-20250929' })],
      }),
    ];

    const result = extractSubagentModels(processes, mainModel);
    expect(result).toHaveLength(0);
  });

  it('returns empty for no processes', () => {
    const result = extractSubagentModels([], null);
    expect(result).toHaveLength(0);
  });

  it('handles null main model (includes all subagent models)', () => {
    const processes = [
      makeProcess({
        messages: [makeMsg({ model: 'claude-sonnet-4-5-20250929' })],
      }),
    ];

    const result = extractSubagentModels(processes, null);
    expect(result).toHaveLength(1);
  });

  it('skips processes with no assistant messages', () => {
    const processes = [
      makeProcess({
        messages: [makeMsg({ type: 'user', model: undefined })],
      }),
    ];

    const result = extractSubagentModels(processes, null);
    expect(result).toHaveLength(0);
  });
});
