import { describe, it, expect } from 'vitest';
import { processSessionContextWithPhases } from '../../src/client/utils/context-tracker.js';
import type { ChatItem, UserGroup, AIGroup, CompactGroup } from '../../src/client/types/groups.js';
import type { ParsedMessage, SemanticStep } from '../../src/server/types/jsonl.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: 'msg-' + Math.random().toString(36).slice(2, 8),
    parentUuid: null,
    type: 'user',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function makeUserItem(text: string, opts?: {
  fileReferences?: { path: string }[];
  rawText?: string;
}): ChatItem {
  const rawText = opts?.rawText ?? text;
  const group: UserGroup = {
    id: `user-${Math.random().toString(36).slice(2, 8)}`,
    message: makeMsg({ content: rawText }),
    timestamp: new Date('2025-01-01T00:00:00Z'),
    content: {
      text,
      rawText,
      commands: [],
      images: [],
      fileReferences: opts?.fileReferences ?? [],
    },
    index: 0,
  };
  return { type: 'user', group };
}

function makeAIItem(steps: SemanticStep[], id?: string): ChatItem {
  const group: AIGroup = {
    id: id ?? `ai-${Math.random().toString(36).slice(2, 8)}`,
    turnIndex: 0,
    startTime: new Date('2025-01-01T00:00:01Z'),
    endTime: new Date('2025-01-01T00:00:02Z'),
    durationMs: 1000,
    steps,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, total: 150 },
    summary: {
      toolCallCount: steps.filter(s => s.type === 'tool_call').length,
      outputMessageCount: steps.filter(s => s.type === 'output').length,
      subagentCount: 0,
      totalDurationMs: 1000,
      totalTokens: 150,
      outputTokens: 50,
      cachedTokens: 0,
    },
    status: 'complete',
    processes: [],
    chunkId: 'chunk-0',
    responses: [],
    isOngoing: false,
  };
  return { type: 'ai', group };
}

function makeCompactItem(): ChatItem {
  const group: CompactGroup = {
    id: `compact-${Date.now()}`,
    timestamp: new Date('2025-01-01T01:00:00Z'),
    summary: 'Conversation compacted',
    message: makeMsg({ type: 'summary', content: 'Conversation compacted' }),
  };
  return { type: 'compact', group };
}

function step(
  type: SemanticStep['type'],
  content: string,
  toolName?: string,
  toolCallId?: string,
): SemanticStep {
  return {
    type,
    content,
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('processSessionContextWithPhases', () => {
  it('empty items array produces empty map and no phases', () => {
    const result = processSessionContextWithPhases([]);
    expect(result.statsMap.size).toBe(0);
    expect(result.phases).toHaveLength(0);
  });

  it('computes per-turn stats for a sequence of user + AI items', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello world'),
      makeAIItem([
        step('thinking', 'Processing user request'),
        step('output', 'Hi there'),
      ], 'ai-turn-0'),
      makeUserItem('Second message'),
      makeAIItem([
        step('thinking', 'Another thought'),
        step('output', 'Another response'),
      ], 'ai-turn-1'),
    ];

    const result = processSessionContextWithPhases(items);

    expect(result.statsMap.size).toBe(2);
    expect(result.statsMap.has('ai-turn-0')).toBe(true);
    expect(result.statsMap.has('ai-turn-1')).toBe(true);

    const stats0 = result.statsMap.get('ai-turn-0')!;
    expect(stats0.turnIndex).toBe(0);
    expect(stats0.turnTokens.userMessages).toBeGreaterThan(0);
    // thinkingText counts thinking steps; the last output step is excluded
    // (it's the chat bubble, matching devtools behavior)
    expect(stats0.turnTokens.thinkingText).toBeGreaterThan(0);

    const stats1 = result.statsMap.get('ai-turn-1')!;
    expect(stats1.turnIndex).toBe(1);
  });

  it('cumulative tokens accumulate across turns', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello'),
      makeAIItem([step('output', 'Response A')], 'ai-0'),
      makeUserItem('World'),
      makeAIItem([step('output', 'Response B')], 'ai-1'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats0 = result.statsMap.get('ai-0')!;
    const stats1 = result.statsMap.get('ai-1')!;

    // Cumulative at turn 1 should include tokens from both turns
    expect(stats1.cumulativeTokens.userMessages).toBeGreaterThan(
      stats0.cumulativeTokens.userMessages,
    );
    expect(stats1.totalTokens).toBeGreaterThan(stats0.totalTokens);
  });

  it('phase boundaries (compact items) reset cumulative counts', () => {
    const items: ChatItem[] = [
      makeUserItem('Pre-compact message'),
      makeAIItem([step('output', 'Pre-compact response')], 'ai-pre'),
      makeCompactItem(),
      makeUserItem('Post-compact message'),
      makeAIItem([step('output', 'Post-compact response')], 'ai-post'),
    ];

    const result = processSessionContextWithPhases(items);
    const statsPre = result.statsMap.get('ai-pre')!;
    const statsPost = result.statsMap.get('ai-post')!;

    // Post-compact cumulative should only reflect post-compact turn
    // (cumulative was reset by compact boundary)
    expect(statsPost.cumulativeTokens.userMessages).toBe(statsPost.turnTokens.userMessages);
    expect(statsPost.cumulativeTokens.thinkingText).toBe(statsPost.turnTokens.thinkingText);

    // Pre-compact stats should be independent of post-compact
    expect(statsPre.turnIndex).toBe(0);
    expect(statsPost.turnIndex).toBe(1);
  });

  it('CLAUDE.md content attributed to claudeMd category', () => {
    const items: ChatItem[] = [
      makeUserItem(
        'Contents of /home/user/.claude/CLAUDE.md ...',
        { rawText: 'Contents of /home/user/.claude/CLAUDE.md with instructions' },
      ),
      makeAIItem([step('output', 'Ok')], 'ai-claude-md'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-claude-md')!;

    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
  });

  it('system-reminder content attributed to claudeMd category', () => {
    const items: ChatItem[] = [
      makeUserItem(
        'Instructions <system-reminder>Some config</system-reminder>',
        { rawText: 'Instructions <system-reminder>Some config</system-reminder>' },
      ),
      makeAIItem([step('output', 'Acknowledged')], 'ai-sysrem'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-sysrem')!;

    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    // With independent tracking, "Instructions " portion is attributed to userMessages
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
  });

  it('file reference content attributed to mentionedFiles category', () => {
    const items: ChatItem[] = [
      makeUserItem('Check @src/main.ts please', {
        fileReferences: [{ path: 'src/main.ts' }],
      }),
      makeAIItem([step('output', 'Reading file')], 'ai-files'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-files')!;

    expect(stats.turnTokens.mentionedFiles).toBeGreaterThan(0);
    // With independent tracking, user text portion is also tracked separately
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
  });

  it('mixed CLAUDE.md + file references + user text tracked independently', () => {
    const rawText =
      'Please review this.\n' +
      'Contents of /home/user/.claude/CLAUDE.md\nSome CLAUDE.md instructions here.\n' +
      'Check @src/main.ts too.';
    const items: ChatItem[] = [
      makeUserItem(rawText, {
        rawText,
        fileReferences: [{ path: 'src/main.ts' }],
      }),
      makeAIItem([step('output', 'Ok')], 'ai-mixed'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-mixed')!;

    // All three categories should have non-zero tokens
    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    expect(stats.turnTokens.mentionedFiles).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);

    // Breakdowns should also have entries for each
    expect(stats.claudeMdItems).toBeDefined();
    expect(stats.claudeMdItems!.length).toBeGreaterThan(0);
    expect(stats.mentionedFileItems).toBeDefined();
    expect(stats.mentionedFileItems!.length).toBeGreaterThan(0);
    expect(stats.userMessageItems).toBeDefined();
    expect(stats.userMessageItems!.length).toBeGreaterThan(0);
  });

  it('CLAUDE.md with user text splits tokens independently', () => {
    const rawText =
      'Hello, please help me.\n<system-reminder>Important config data here</system-reminder>';
    const items: ChatItem[] = [
      makeUserItem(rawText, { rawText }),
      makeAIItem([step('output', 'Sure')], 'ai-claude-user'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-claude-user')!;

    // claudeMd gets system-reminder tokens, userMessages gets the rest
    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
  });

  it('regular user messages attributed to userMessages category', () => {
    const items: ChatItem[] = [
      makeUserItem('Just a plain question'),
      makeAIItem([step('output', 'Answer')], 'ai-plain'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-plain')!;

    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
  });

  it('tool calls attributed to toolOutputs for regular tools', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Read file content', 'Read'),
        step('tool_result', 'File content here'),
      ], 'ai-tool'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-tool')!;

    expect(stats.turnTokens.toolOutputs).toBeGreaterThan(0);
    expect(stats.turnTokens.taskCoordination).toBe(0);
  });

  it('coordination tools attributed to taskCoordination category', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Create task for implementation', 'TaskCreate'),
        step('tool_result', 'Task created', 'TaskCreate'),
        step('tool_call', 'Send message to subagent', 'SendMessage'),
        step('tool_result', 'Message sent', 'SendMessage'),
      ], 'ai-coord'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-coord')!;

    expect(stats.turnTokens.taskCoordination).toBeGreaterThan(0);
    // tool_result steps for coordination tools also go to taskCoordination
    expect(stats.turnTokens.toolOutputs).toBe(0);
  });

  it('thinking steps attributed to thinkingText category', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('thinking', 'Let me analyze this problem carefully...'),
        step('output', 'Here is the answer'),
      ], 'ai-thinking'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-thinking')!;

    expect(stats.turnTokens.thinkingText).toBeGreaterThan(0);
  });

  it('multiple phases created correctly with compact boundaries', () => {
    const items: ChatItem[] = [
      makeUserItem('Phase 1 msg 1'),
      makeAIItem([step('output', 'R1')], 'ai-p1-0'),
      makeUserItem('Phase 1 msg 2'),
      makeAIItem([step('output', 'R2')], 'ai-p1-1'),
      makeCompactItem(),
      makeUserItem('Phase 2 msg 1'),
      makeAIItem([step('output', 'R3')], 'ai-p2-0'),
      makeCompactItem(),
      makeUserItem('Phase 3 msg 1'),
      makeAIItem([step('output', 'R4')], 'ai-p3-0'),
    ];

    const result = processSessionContextWithPhases(items);

    expect(result.phases).toHaveLength(3);

    expect(result.phases[0].phaseIndex).toBe(0);
    expect(result.phases[0].startTurn).toBe(0);
    expect(result.phases[0].endTurn).toBe(1);
    expect(result.phases[0].compactedTokens).toBeGreaterThan(0);
    expect(result.phases[0].label).toBe('Phase 1');

    expect(result.phases[1].phaseIndex).toBe(1);
    expect(result.phases[1].startTurn).toBe(2);
    expect(result.phases[1].endTurn).toBe(2);
    expect(result.phases[1].compactedTokens).toBeGreaterThan(0);
    expect(result.phases[1].label).toBe('Phase 2');

    expect(result.phases[2].phaseIndex).toBe(2);
    expect(result.phases[2].startTurn).toBe(3);
    expect(result.phases[2].endTurn).toBe(3);
    expect(result.phases[2].compactedTokens).toBe(0); // Last phase not compacted
    expect(result.phases[2].label).toBe('Phase 3');
  });

  it('AI item without preceding user item produces stats with zero user tokens', () => {
    // Include thinking so thinkingText > 0. The last 'output' step is excluded
    // from thinking/text (it's the final chat bubble, matching devtools behavior).
    const items: ChatItem[] = [
      makeAIItem([
        step('thinking', 'Let me think about this'),
        step('output', 'Autonomous response'),
      ], 'ai-no-user'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-no-user')!;

    expect(stats.turnTokens.userMessages).toBe(0);
    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.turnTokens.mentionedFiles).toBe(0);
    expect(stats.turnTokens.thinkingText).toBeGreaterThan(0);
  });

  it('system items are skipped and do not affect stats', () => {
    const systemItem: ChatItem = {
      type: 'system',
      group: {
        id: 'system-1',
        message: makeMsg({ type: 'system', content: 'command output' }),
        timestamp: new Date('2025-01-01T00:00:00Z'),
        commandOutput: 'command output',
      },
    };

    const items: ChatItem[] = [
      makeUserItem('Hello'),
      systemItem,
      makeAIItem([step('output', 'Hi')], 'ai-with-system'),
    ];

    const result = processSessionContextWithPhases(items);
    expect(result.statsMap.size).toBe(1);
    const stats = result.statsMap.get('ai-with-system')!;
    expect(stats.turnIndex).toBe(0);
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
  });

  it('handles consecutive compact items with no AI groups between them', () => {
    const items: ChatItem[] = [
      makeAIItem([step('output', 'hello')], 'ai-1'),
      makeCompactItem(),
      makeCompactItem(), // second compact immediately after first
      makeAIItem([step('output', 'world')], 'ai-2'),
    ];
    const result = processSessionContextWithPhases(items);
    expect(result.statsMap.size).toBe(2);
    // Should have 3 phases: before first compact, empty between compacts, after second compact
    // Or 2 phases if the empty phase is skipped
    expect(result.phases.length).toBeGreaterThanOrEqual(2);
  });

  // ─── New: per-tool-call breakdown tests ─────────────────────────────────────

  it('each tool call produces a separate toolOutputItem entry', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Read first file', 'Read', 'call-1'),
        step('tool_result', 'First file content here, fairly long content for testing', 'Read', 'call-1'),
        step('tool_call', 'Read second file', 'Read', 'call-2'),
        step('tool_result', 'Second file content', 'Read', 'call-2'),
        step('tool_call', 'Run grep search', 'Grep', 'call-3'),
        step('tool_result', 'Grep results output', 'Grep', 'call-3'),
      ], 'ai-multi-tool'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-multi-tool')!;

    // Should have 3 separate entries (one per call), NOT 2 (aggregated by name)
    expect(stats.toolOutputItems).toBeDefined();
    expect(stats.toolOutputItems!.length).toBe(3);

    // First two should be Read, third should be Grep
    expect(stats.toolOutputItems![0].toolName).toBe('Read');
    expect(stats.toolOutputItems![1].toolName).toBe('Read');
    expect(stats.toolOutputItems![2].toolName).toBe('Grep');

    // Each entry's tokens should be callTokens + result.tokenCount.
    // callTokens = estimateTokens(toolName + JSON.stringify(input)) where input is {} (no responses).
    // result.tokenCount = estimateTokens(tool_result step content).
    const call1Tokens = Math.ceil(('Read' + '{}').length / 4) +
      Math.ceil('First file content here, fairly long content for testing'.length / 4);
    expect(stats.toolOutputItems![0].tokenCount).toBe(call1Tokens);
  });

  it('tool calls without toolCallId still produce separate entries', () => {
    const items: ChatItem[] = [
      makeAIItem([
        step('tool_call', 'Read something', 'Read'),
        step('tool_call', 'Read another', 'Read'),
        step('tool_call', 'Run skill', 'Skill'),
      ], 'ai-no-id'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-no-id')!;

    // Without toolCallId, each call gets a unique key and produces its own entry
    expect(stats.toolOutputItems).toBeDefined();
    expect(stats.toolOutputItems!.length).toBe(3);
  });

  // ─── New: CLAUDE.md section extraction tests ────────────────────────────────

  it('multiple CLAUDE.md files produce separate claudeMdItems', () => {
    const rawText =
      'Contents of /home/user/.claude/CLAUDE.md (global):\n' +
      'Global instructions line 1\nGlobal instructions line 2\n' +
      'Contents of /project/CLAUDE.md (project):\n' +
      'Project instructions line 1\nProject instructions line 2\n';
    const items: ChatItem[] = [
      makeUserItem(rawText, { rawText }),
      makeAIItem([step('output', 'Ok')], 'ai-two-claude'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-two-claude')!;

    expect(stats.claudeMdItems).toBeDefined();
    expect(stats.claudeMdItems!.length).toBe(2);
    expect(stats.claudeMdItems![0].label).toContain('.claude/CLAUDE.md');
    expect(stats.claudeMdItems![1].label).toContain('/project/CLAUDE.md');

    // Each section should have its own token count
    expect(stats.claudeMdItems![0].tokens).toBeGreaterThan(0);
    expect(stats.claudeMdItems![1].tokens).toBeGreaterThan(0);
  });

  // ─── New: mentioned file content extraction from "Contents of" headers ──────

  it('mentioned file content extracted from "Contents of" sections', () => {
    const rawText =
      'Please review:\n' +
      'Contents of /home/user/.claude/CLAUDE.md (global):\n' +
      'Some CLAUDE config\n' +
      'Contents of docs/plan.md (referenced file):\n' +
      'This is the plan file content with many lines of text here.\n';
    const items: ChatItem[] = [
      makeUserItem(rawText, {
        rawText,
        fileReferences: [{ path: 'docs/plan.md' }],
      }),
      makeAIItem([step('output', 'Reviewed')], 'ai-file-contents'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-file-contents')!;

    // CLAUDE.md content goes to claudeMd
    expect(stats.turnTokens.claudeMd).toBeGreaterThan(0);
    // Mentioned file content goes to mentionedFiles
    expect(stats.turnTokens.mentionedFiles).toBeGreaterThan(0);
    // "Please review:" goes to userMessages
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);

    // mentionedFileItems should reference the file path from the "Contents of" header
    expect(stats.mentionedFileItems).toBeDefined();
    expect(stats.mentionedFileItems!.length).toBe(1);
    expect(stats.mentionedFileItems![0].label).toContain('docs/plan.md');
  });

  // ─── New: user message = remainder after stripping injected content ─────────

  it('user message tokens are the remainder after removing injected content', () => {
    const userTyped = 'Please help me with this task.';
    const claudeMdContent =
      'Contents of /home/user/.claude/CLAUDE.md\n' +
      'A'.repeat(400) + '\n'; // ~100 tokens of CLAUDE.md
    const rawText = userTyped + '\n' + claudeMdContent;

    const items: ChatItem[] = [
      makeUserItem(rawText, { rawText }),
      makeAIItem([step('output', 'Ok')], 'ai-remainder'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-remainder')!;

    // User message should be much smaller than CLAUDE.md content
    expect(stats.turnTokens.userMessages).toBeLessThan(stats.turnTokens.claudeMd);
    // User message tokens should approximate the user's typed text
    const expectedUserTokens = Math.ceil((userTyped + '\n').length / 4);
    expect(stats.turnTokens.userMessages).toBe(expectedUserTokens);
  });

  // ─── New: thinking + text breakdown ─────────────────────────────────────────

  it('thinkingTextDetail separates thinking from output tokens', () => {
    const thinkingContent = 'Let me think carefully about the approach to take here...';
    const intermediateOutput = 'Let me explore the codebase.';
    const finalOutput = 'Here is the concise answer.';
    // The last output step is excluded from thinking/text (it's the chat bubble).
    // Include an intermediate output (e.g., text before tool calls) and a final output.
    const items: ChatItem[] = [
      makeAIItem([
        step('thinking', thinkingContent),
        step('output', intermediateOutput),
        step('tool_call', 'Read', 'Read', 'tc-1'),
        step('tool_result', 'file content', 'Read', 'tc-1'),
        step('output', finalOutput),
      ], 'ai-breakdown'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-breakdown')!;

    expect(stats.thinkingTextDetail).toBeDefined();
    expect(stats.thinkingTextDetail!.thinking).toBe(Math.ceil(thinkingContent.length / 4));
    // Only the intermediate output is counted; the final output is excluded
    expect(stats.thinkingTextDetail!.text).toBe(Math.ceil(intermediateOutput.length / 4));
    expect(stats.turnTokens.thinkingText).toBe(
      stats.thinkingTextDetail!.thinking + stats.thinkingTextDetail!.text,
    );
  });

  // ─── New: realistic devtools-matching scenario ──────────────────────────────

  it('matches devtools attribution for realistic first AI group scenario', () => {
    // Simulates the real scenario from the task description:
    // - User types a short message (~87 tokens)
    // - Two CLAUDE.md files injected (~4.9k + ~2.8k = ~7.7k tokens)
    // - One mentioned file injected (~4.9k tokens)
    // - AI responds with 5 tool calls and thinking+text

    const userTyped = '@docs/plans/stage-9f-session-detail-display-handoff.md Read the referenced file and study the implementation plan. Then explore the codebase to understand the current state.';
    const claudeMd1 = 'A'.repeat(19600); // ~4.9k tokens
    const claudeMd2 = 'B'.repeat(11200); // ~2.8k tokens
    const mentionedFile = 'C'.repeat(19600); // ~4.9k tokens

    const rawText =
      userTyped + '\n' +
      '<system-reminder>\n' +
      'Contents of /home/user/.claude/CLAUDE.md (global):\n' +
      claudeMd1 + '\n' +
      'Contents of /project/CLAUDE.md (project):\n' +
      claudeMd2 + '\n' +
      '</system-reminder>\n' +
      'Contents of docs/plans/stage-9f-session-detail-display-handoff.md:\n' +
      mentionedFile + '\n';

    const items: ChatItem[] = [
      makeUserItem(rawText, {
        rawText,
        fileReferences: [{ path: 'docs/plans/stage-9f-session-detail-display-handoff.md' }],
      }),
      makeAIItem([
        step('thinking', 'D'.repeat(200)),
        step('output', 'E'.repeat(400)),
        step('tool_call', 'F'.repeat(100), 'Read', 'tc-1'),
        step('tool_result', 'G'.repeat(9200), 'Read', 'tc-1'),
        step('tool_call', 'H'.repeat(80), 'Read', 'tc-2'),
        step('tool_result', 'I'.repeat(2564), 'Read', 'tc-2'),
        step('tool_call', 'J'.repeat(100), 'Read', 'tc-3'),
        step('tool_result', 'K'.repeat(8300), 'Read', 'tc-3'),
        step('tool_call', 'L'.repeat(80), 'Read', 'tc-4'),
        step('tool_result', 'M'.repeat(2860), 'Read', 'tc-4'),
        step('tool_call', 'N'.repeat(100), 'Skill', 'tc-5'),
        step('tool_result', 'O'.repeat(3240), 'Skill', 'tc-5'),
        // Final text response (the chat bubble) — excluded from thinking/text count
        step('output', 'P'.repeat(300)),
      ], 'ai-realistic'),
    ];

    const result = processSessionContextWithPhases(items);
    const stats = result.statsMap.get('ai-realistic')!;

    // User message: just the typed text (~45 tokens for the short command)
    expect(stats.turnTokens.userMessages).toBeGreaterThan(0);
    expect(stats.turnTokens.userMessages).toBeLessThan(200);

    // CLAUDE.md: two files (~7.7k tokens total)
    expect(stats.turnTokens.claudeMd).toBeGreaterThan(7000);
    expect(stats.claudeMdItems).toBeDefined();
    // System-reminder wraps both CLAUDE.md files, so it's one claudeMd item
    // (the system-reminder block contains both "Contents of" sections)
    expect(stats.claudeMdItems!.length).toBeGreaterThanOrEqual(1);

    // Mentioned files: one file (~4.9k tokens)
    expect(stats.turnTokens.mentionedFiles).toBeGreaterThan(4000);
    expect(stats.mentionedFileItems).toBeDefined();
    expect(stats.mentionedFileItems!.length).toBe(1);

    // Tool outputs: 5 separate entries (not aggregated)
    expect(stats.toolOutputItems).toBeDefined();
    expect(stats.toolOutputItems!.length).toBe(5);

    // Thinking + text
    expect(stats.thinkingTextDetail).toBeDefined();
    expect(stats.thinkingTextDetail!.thinking).toBe(Math.ceil(200 / 4));
    expect(stats.thinkingTextDetail!.text).toBe(Math.ceil(400 / 4));
  });

  // ─── claudeMdFiles (server-provided disk-based estimates) ─────────────────

  it('injects claudeMdFiles into first AI group when provided', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello'),
      makeAIItem([step('output', 'Hi')], 'ai-0'),
      makeUserItem('Second'),
      makeAIItem([step('output', 'Response')], 'ai-1'),
    ];

    const claudeMdFiles = [
      { path: '/home/user/.claude/CLAUDE.md', estimatedTokens: 4900 },
      { path: '/project/CLAUDE.md', estimatedTokens: 2800 },
    ];

    const result = processSessionContextWithPhases(items, claudeMdFiles);

    // First AI group should have CLAUDE.md tokens
    const stats0 = result.statsMap.get('ai-0')!;
    expect(stats0.turnTokens.claudeMd).toBe(4900 + 2800);
    expect(stats0.claudeMdItems).toBeDefined();
    expect(stats0.claudeMdItems!.length).toBe(2);
    expect(stats0.claudeMdItems![0].label).toBe('/home/user/.claude/CLAUDE.md');
    expect(stats0.claudeMdItems![0].tokens).toBe(4900);
    expect(stats0.claudeMdItems![1].label).toBe('/project/CLAUDE.md');
    expect(stats0.claudeMdItems![1].tokens).toBe(2800);

    // Second AI group should NOT have CLAUDE.md tokens
    const stats1 = result.statsMap.get('ai-1')!;
    expect(stats1.turnTokens.claudeMd).toBe(0);
    expect(stats1.claudeMdItems).toBeUndefined();

    // Cumulative should carry CLAUDE.md through
    expect(stats1.cumulativeTokens.claudeMd).toBe(4900 + 2800);
  });

  it('claudeMdFiles not injected when rawText already has CLAUDE.md content', () => {
    const items: ChatItem[] = [
      makeUserItem(
        'Contents of /home/user/.claude/CLAUDE.md with instructions',
        { rawText: 'Contents of /home/user/.claude/CLAUDE.md with instructions' },
      ),
      makeAIItem([step('output', 'Ok')], 'ai-0'),
    ];

    const claudeMdFiles = [
      { path: '/home/user/.claude/CLAUDE.md', estimatedTokens: 4900 },
    ];

    const result = processSessionContextWithPhases(items, claudeMdFiles);
    const stats = result.statsMap.get('ai-0')!;

    // Should use the rawText-detected value, not the server-provided one
    expect(stats.claudeMdItems).toBeDefined();
    expect(stats.claudeMdItems!.length).toBe(1);
    // The detected tokens from rawText (~15 tokens) should be much less than 4900
    expect(stats.turnTokens.claudeMd).toBeLessThan(100);
  });

  it('claudeMdFiles re-injected after compact boundary', () => {
    const items: ChatItem[] = [
      makeUserItem('Pre-compact'),
      makeAIItem([step('output', 'R1')], 'ai-pre'),
      makeCompactItem(),
      makeUserItem('Post-compact'),
      makeAIItem([step('output', 'R2')], 'ai-post'),
    ];

    const claudeMdFiles = [
      { path: '/home/user/.claude/CLAUDE.md', estimatedTokens: 3000 },
    ];

    const result = processSessionContextWithPhases(items, claudeMdFiles);

    // Both first AI groups (in each phase) should get CLAUDE.md injection
    const statsPre = result.statsMap.get('ai-pre')!;
    expect(statsPre.turnTokens.claudeMd).toBe(3000);

    const statsPost = result.statsMap.get('ai-post')!;
    expect(statsPost.turnTokens.claudeMd).toBe(3000);
  });

  it('empty claudeMdFiles array does not inject anything', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello'),
      makeAIItem([step('output', 'Hi')], 'ai-0'),
    ];

    const result = processSessionContextWithPhases(items, []);
    const stats = result.statsMap.get('ai-0')!;

    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.claudeMdItems).toBeUndefined();
  });

  it('undefined claudeMdFiles does not inject anything', () => {
    const items: ChatItem[] = [
      makeUserItem('Hello'),
      makeAIItem([step('output', 'Hi')], 'ai-0'),
    ];

    const result = processSessionContextWithPhases(items, undefined);
    const stats = result.statsMap.get('ai-0')!;

    expect(stats.turnTokens.claudeMd).toBe(0);
    expect(stats.claudeMdItems).toBeUndefined();
  });
});
