import type { ParsedMessage, Process } from '../types/session.js';
import type { ModelInfo, ModelFamily } from '../types/groups.js';

/**
 * Parse a model string like "claude-sonnet-4-5-20250929" or "claude-3-5-sonnet-20241022"
 * into structured ModelInfo.
 */
export function parseModelString(model: string | undefined): ModelInfo | null {
  if (!model || model === '<synthetic>' || model.trim() === '') return null;

  // New format: claude-{family}-{major}-{minor}-{date}
  const newMatch = model.match(/^claude-(\w+)-(\d+)-(\d+)(?:-\d+)?$/);
  if (newMatch) {
    const family = newMatch[1] as ModelFamily;
    return {
      name: `${family}${newMatch[2]}.${newMatch[3]}`,
      family,
      majorVersion: parseInt(newMatch[2], 10),
      minorVersion: parseInt(newMatch[3], 10),
    };
  }

  // Old format: claude-{major}[-{minor}]-{family}-{date}
  const oldMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(\w+)(?:-\d+)?$/);
  if (oldMatch) {
    const family = oldMatch[3] as ModelFamily;
    const major = parseInt(oldMatch[1], 10);
    const minor = oldMatch[2] ? parseInt(oldMatch[2], 10) : null;
    return {
      name: minor !== null ? `${family}${major}.${minor}` : `${family}${major}`,
      family,
      majorVersion: major,
      minorVersion: minor,
    };
  }

  return null;
}

/**
 * Extract the main model from an AI group's messages.
 * Scans assistant messages for `model` field and returns the most common model found.
 *
 * TODO: Ideally should scan step.sourceModel on tool_call SemanticSteps (matching devtools),
 * but our SemanticStep type lacks sourceModel. Using msg.model on assistant messages as fallback.
 * If sourceModel is added to SemanticStep in the future, switch to that approach.
 */
export function extractMainModel(messages: ParsedMessage[]): ModelInfo | null {
  const counts = new Map<string, number>();
  for (const msg of messages) {
    if (msg.type === 'assistant' && msg.model) {
      counts.set(msg.model, (counts.get(msg.model) ?? 0) + 1);
    }
  }

  let maxModel: string | null = null;
  let maxCount = 0;
  for (const [model, count] of counts) {
    if (count > maxCount) {
      maxModel = model;
      maxCount = count;
    }
  }

  return maxModel ? parseModelString(maxModel) : null;
}

/**
 * Extract unique subagent models that differ from the main model.
 */
export function extractSubagentModels(
  processes: Process[],
  mainModel: ModelInfo | null,
): ModelInfo[] {
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const proc of processes) {
    const firstAssistant = proc.messages.find(
      (m) => m.type === 'assistant' && m.model,
    );
    if (!firstAssistant?.model) continue;

    const info = parseModelString(firstAssistant.model);
    if (!info) continue;
    if (mainModel && info.name === mainModel.name) continue;
    if (seen.has(info.name)) continue;

    seen.add(info.name);
    models.push(info);
  }

  return models;
}
