import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { successResult } from '../types.js';
import { log } from '../logger.js';

export function registerOrchestratorSignalTools(server: McpServer): void {
  server.tool(
    'conversion_complete',
    'Signal that ticket-to-stage conversion is complete. Call this after creating all stage files and updating the ticket frontmatter. The orchestrator will handle syncing and status updates.',
    {},
    async () => {
      log('INFO', 'conversion_complete called');
      return successResult({
        status: 'acknowledged',
        message: 'Conversion complete signal received. System will sync and update statuses.',
      });
    },
  );

  server.tool(
    'transition_stage',
    'Signal a stage transition to the next pipeline phase. The orchestrator validates the transition and updates the stage status.',
    { target: z.string().describe('The target phase name (e.g., "Build", "User Design Feedback", "Done")') },
    async (args) => {
      log('INFO', 'transition_stage called', { target: args.target });
      return successResult({
        status: 'acknowledged',
        target: args.target,
        message: `Transition to "${args.target}" acknowledged. System will validate and apply.`,
      });
    },
  );
}
