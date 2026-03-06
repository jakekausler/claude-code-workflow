import type { AIGroup, EnhancedAIGroup, SlashItem, LinkedToolItemData } from '../types/groups.js';
import type { Process } from '../types/session.js';
import { findLastOutput } from './last-output-detector.js';
import { buildDisplayItems } from './display-item-builder.js';
import { buildSummary } from './display-summary.js';
import { extractMainModel, extractSubagentModels } from './model-extractor.js';

/**
 * Enhance an AIGroup with linked tools, display items, summary, and model info.
 * This is the main orchestrator that calls all enrichment functions.
 */
export function enhanceAIGroup(
  aiGroup: AIGroup,
  claudeMdStats?: { paths: string[]; totalTokens: number },
  precedingSlash?: SlashItem,
): EnhancedAIGroup {
  // 1. Find last output
  const lastOutput = findLastOutput(aiGroup.steps, aiGroup.isOngoing);

  // 2. Build display items (includes tool linking internally)
  const { items: displayItems, linkedTools } = buildDisplayItems(
    aiGroup.steps,
    lastOutput,
    aiGroup.processes,
    aiGroup.responses,
    precedingSlash,
  );

  // 3. Attach mainSessionImpact to subagent processes
  attachMainSessionImpact(aiGroup.processes, linkedTools);

  // 4. Build summary
  const itemsSummary = buildSummary(displayItems);

  // 5. Extract models
  const mainModel = extractMainModel(aiGroup.responses);
  const subagentModels = extractSubagentModels(aiGroup.processes, mainModel);

  return {
    ...aiGroup,
    lastOutput,
    displayItems,
    linkedTools,
    itemsSummary,
    mainModel,
    subagentModels,
    claudeMdStats: claudeMdStats ?? null,
  };
}

/**
 * For each subagent with a parentTaskId, find the matching Task tool
 * and set mainSessionImpact (how many tokens the subagent cost in the parent context).
 *
 * Note: Mutates processes in-place. This is intentional — the enhanced result
 * shares the processes array with the input AIGroup.
 */
function attachMainSessionImpact(
  processes: Process[],
  linkedTools: Map<string, LinkedToolItemData>,
): void {
  for (const proc of processes) {
    if (!proc.parentTaskId) continue;
    const taskTool = linkedTools.get(proc.parentTaskId);
    if (!taskTool) continue;

    const callTokens = taskTool.callTokens ?? 0;
    const resultTokens = taskTool.result?.tokenCount ?? 0;
    proc.mainSessionImpact = {
      callTokens,
      resultTokens,
      totalTokens: callTokens + resultTokens,
    };
  }
}
