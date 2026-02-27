import { describe, it, expect } from 'vitest';
import { calculateCost, calculateSessionCost } from '../../../src/server/services/pricing.js';
import type { ParsedMessage } from '../../../src/server/types/jsonl.js';

describe('PricingEngine', () => {
  describe('calculateCost', () => {
    it('calculates correct cost for claude-sonnet-4-6', () => {
      const cost = calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: 'claude-sonnet-4-6',
      });
      // input: 1M * $3/M = $3, output: 1M * $15/M = $15
      expect(cost).toBeCloseTo(18, 2);
    });

    it('calculates correct cost for claude-opus-4-6', () => {
      const cost = calculateCost({
        inputTokens: 100_000,
        outputTokens: 50_000,
        model: 'claude-opus-4-6',
      });
      // input: 100K * $15/M = $1.50, output: 50K * $75/M = $3.75
      expect(cost).toBeCloseTo(5.25, 2);
    });

    it('calculates correct cost for claude-haiku-4-5', () => {
      const cost = calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        model: 'claude-haiku-4-5-20251001',
      });
      // input: 1M * $0.8/M = $0.80, output: 1M * $4/M = $4.00
      expect(cost).toBeCloseTo(4.8, 2);
    });

    it('includes cache token costs', () => {
      const cost = calculateCost({
        inputTokens: 100_000,
        outputTokens: 10_000,
        cacheCreationTokens: 50_000,
        cacheReadTokens: 200_000,
        model: 'claude-sonnet-4-6',
      });
      // input: 100K * $3/M = $0.30
      // output: 10K * $15/M = $0.15
      // cacheCreation: 50K * $3.75/M = $0.1875
      // cacheRead: 200K * $0.3/M = $0.06
      expect(cost).toBeCloseTo(0.6975, 4);
    });

    it('returns 0 for unknown model', () => {
      const cost = calculateCost({
        inputTokens: 100_000,
        outputTokens: 50_000,
        model: 'unknown-model',
      });
      expect(cost).toBe(0);
    });

    it('matches model by prefix for versioned model names', () => {
      const cost = calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 0,
        model: 'claude-sonnet-4-6-20260225',
      });
      // Should match claude-sonnet-4-6 pricing: 1M * $3/M = $3
      expect(cost).toBeCloseTo(3, 2);
    });

    it('prefix match returns the first matching entry (no longest-prefix guarantee)', () => {
      // 'claude-haiku-4-5-20251001' is an exact key in MODEL_PRICING.
      // A versioned variant like 'claude-haiku-4-5-20251001-extra' should
      // hit the exact entry first because exact match is checked before
      // prefix iteration. This documents that prefix matching uses
      // insertion-order iteration, so the first matching prefix wins.
      const cost = calculateCost({
        inputTokens: 1_000_000,
        outputTokens: 0,
        model: 'claude-haiku-4-5-20251001-extra',
      });
      // Should match claude-haiku-4-5-20251001 pricing: 1M * $0.8/M = $0.80
      expect(cost).toBeCloseTo(0.8, 2);
    });
  });

  describe('calculateSessionCost', () => {
    it('returns zero for empty messages', () => {
      const result = calculateSessionCost([]);
      expect(result.totalCost).toBe(0);
      expect(result.costByModel).toEqual({});
    });

    it('aggregates across multiple assistant messages', () => {
      const messages: ParsedMessage[] = [
        createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000),
        createAssistantMsg('claude-sonnet-4-6', 200_000, 20_000),
      ];
      const result = calculateSessionCost(messages);
      // msg1: 100K*3/M + 10K*15/M = $0.30 + $0.15 = $0.45
      // msg2: 200K*3/M + 20K*15/M = $0.60 + $0.30 = $0.90
      expect(result.totalCost).toBeCloseTo(1.35, 2);
    });

    it('provides costByModel breakdown', () => {
      const messages: ParsedMessage[] = [
        createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000),
        createAssistantMsg('claude-opus-4-6', 50_000, 5_000),
      ];
      const result = calculateSessionCost(messages);
      expect(Object.keys(result.costByModel)).toHaveLength(2);
      expect(result.costByModel['claude-sonnet-4-6']).toBeCloseTo(0.45, 2);
      expect(result.costByModel['claude-opus-4-6']).toBeCloseTo(1.125, 3);
    });

    it('skips non-assistant messages', () => {
      const messages: ParsedMessage[] = [
        {
          uuid: 'u1',
          parentUuid: null,
          type: 'user',
          timestamp: new Date(),
          isSidechain: false,
          isMeta: false,
          content: 'Hi',
          toolCalls: [],
          toolResults: [],
        },
        createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000),
      ];
      const result = calculateSessionCost(messages);
      expect(result.totalCost).toBeCloseTo(0.45, 2);
    });

    it('handles messages without usage', () => {
      const msg = createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000);
      (msg as any).usage = undefined;
      const result = calculateSessionCost([msg]);
      expect(result.totalCost).toBe(0);
    });

    it('aggregates cache token costs across session messages', () => {
      const messages: ParsedMessage[] = [
        createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000, 50_000, 200_000),
        createAssistantMsg('claude-sonnet-4-6', 100_000, 10_000, 0, 300_000),
      ];
      const result = calculateSessionCost(messages);
      // msg1: input 100K*3/M=$0.30, output 10K*15/M=$0.15,
      //        cacheCreate 50K*3.75/M=$0.1875, cacheRead 200K*0.3/M=$0.06
      //        total = $0.6975
      // msg2: input 100K*3/M=$0.30, output 10K*15/M=$0.15,
      //        cacheCreate 0, cacheRead 300K*0.3/M=$0.09
      //        total = $0.54
      // session total = $1.2375
      expect(result.totalCost).toBeCloseTo(1.2375, 4);
      expect(result.costByModel['claude-sonnet-4-6']).toBeCloseTo(1.2375, 4);
    });
  });
});

function createAssistantMsg(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens?: number,
  cacheReadTokens?: number,
): ParsedMessage {
  return {
    uuid: `a${Math.random()}`,
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date(),
    isSidechain: false,
    isMeta: false,
    content: [{ type: 'text', text: 'Response' }],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ...(cacheCreationTokens !== undefined && { cache_creation_input_tokens: cacheCreationTokens }),
      ...(cacheReadTokens !== undefined && { cache_read_input_tokens: cacheReadTokens }),
    },
    model,
    toolCalls: [],
    toolResults: [],
  };
}
