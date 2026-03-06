import type { AIGroupDisplayItem } from '../types/groups.js';

/**
 * Build a summary string like "2 thinking, 4 tool calls, 1 message, 2 teammates, 1 subagent"
 *
 * Distinguishes between:
 * - Team subagents (Process objects with `team` property) -> counted by unique `memberName`,
 *   reported as "N teammate(s)"
 * - Regular subagents (no `team` property) -> reported as "N subagent(s)"
 * - teammate_message display items -> reported as "N teammate message(s)"
 */
export function buildSummary(items: AIGroupDisplayItem[]): string {
  if (items.length === 0) return 'No items';

  let thinking = 0;
  let tools = 0;
  let outputs = 0;
  const teamMemberNames = new Set<string>();
  let regularSubagents = 0;
  let slashes = 0;
  let teammateMessages = 0;
  let compactions = 0;

  for (const item of items) {
    switch (item.type) {
      case 'thinking': thinking++; break;
      case 'tool': tools++; break;
      case 'output': outputs++; break;
      case 'subagent':
        if (item.subagent.team) {
          teamMemberNames.add(item.subagent.team.memberName ?? item.subagent.id);
        } else {
          regularSubagents++;
        }
        break;
      case 'slash': slashes++; break;
      case 'teammate_message': teammateMessages++; break;
      case 'compact_boundary': compactions++; break;
    }
  }

  const parts: string[] = [];
  if (thinking > 0) parts.push(`${thinking} thinking`);
  if (tools > 0) parts.push(`${tools} tool call${tools !== 1 ? 's' : ''}`);
  if (outputs > 0) parts.push(`${outputs} message${outputs !== 1 ? 's' : ''}`);
  if (teamMemberNames.size > 0) parts.push(`${teamMemberNames.size} teammate${teamMemberNames.size !== 1 ? 's' : ''}`);
  if (regularSubagents > 0) parts.push(`${regularSubagents} subagent${regularSubagents !== 1 ? 's' : ''}`);
  if (teammateMessages > 0) parts.push(`${teammateMessages} teammate message${teammateMessages !== 1 ? 's' : ''}`);
  if (slashes > 0) parts.push(`${slashes} slash${slashes !== 1 ? 'es' : ''}`);
  if (compactions > 0) parts.push(`${compactions} compaction${compactions !== 1 ? 's' : ''}`);

  return parts.join(', ');
}
