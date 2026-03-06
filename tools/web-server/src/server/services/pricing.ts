import type { ParsedMessage } from '../types/jsonl.js';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheCreationPerMillion: number;
  cacheReadPerMillion: number;
  /** TODO: Implement tiered pricing logic when models with usage tiers are added */
  tierThreshold?: number;
  /** TODO: Implement tiered pricing logic when models with usage tiers are added */
  inputPerMillionAboveTier?: number;
  /** TODO: Implement tiered pricing logic when models with usage tiers are added */
  outputPerMillionAboveTier?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheCreationPerMillion: 18.75,
    cacheReadPerMillion: 1.5,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheCreationPerMillion: 3.75,
    cacheReadPerMillion: 0.3,
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheCreationPerMillion: 1,
    cacheReadPerMillion: 0.08,
  },
};

/**
 * Look up pricing for a model. Supports exact match and prefix matching
 * (e.g., 'claude-sonnet-4-6-20260225' matches 'claude-sonnet-4-6').
 */
function findPricing(model: string): ModelPricing | undefined {
  // Exact match first
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  // Prefix match: try matching against known model keys
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return undefined;
}

export function calculateCost(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  model: string;
}): number {
  const pricing = findPricing(usage.model);
  if (!pricing) return 0;

  const inputCost = (usage.inputTokens * pricing.inputPerMillion) / 1_000_000;
  const outputCost = (usage.outputTokens * pricing.outputPerMillion) / 1_000_000;
  const cacheCreationCost =
    ((usage.cacheCreationTokens ?? 0) * pricing.cacheCreationPerMillion) / 1_000_000;
  const cacheReadCost =
    ((usage.cacheReadTokens ?? 0) * pricing.cacheReadPerMillion) / 1_000_000;

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

/**
 * Calculate aggregate cost across all assistant messages in a session.
 *
 * The returned `costByModel` keys are the raw model identifiers from messages
 * (e.g., `"claude-sonnet-4-6-20260225"`), not canonical pricing keys. Downstream
 * consumers should expect versioned model name strings as keys.
 */
export function calculateSessionCost(messages: ParsedMessage[]): {
  totalCost: number;
  costByModel: Record<string, number>;
} {
  const costByModel: Record<string, number> = {};
  let totalCost = 0;

  for (const msg of messages) {
    if (msg.type !== 'assistant' || !msg.usage || !msg.model) continue;

    const cost = calculateCost({
      inputTokens: msg.usage.input_tokens ?? 0,
      outputTokens: msg.usage.output_tokens ?? 0,
      cacheCreationTokens: msg.usage.cache_creation_input_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens,
      model: msg.model,
    });

    totalCost += cost;
    costByModel[msg.model] = (costByModel[msg.model] ?? 0) + cost;
  }

  return { totalCost, costByModel };
}
