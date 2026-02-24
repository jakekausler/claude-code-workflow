import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isMockMode } from './types.js';
import { MockState, type MockSeedData } from './state.js';
import { registerJiraTools } from './tools/jira.js';
import { registerPrTools } from './tools/pr.js';
import { registerEnrichTools } from './tools/enrich.js';
import { registerConfluenceTools } from './tools/confluence.js';
import { registerSlackTools } from './tools/slack.js';
import { registerMockAdminTools } from './tools/mock-admin.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createKanbanMcpServer(): McpServer {
  const server = new McpServer({
    name: 'kanban',
    version: '0.1.0',
  });

  let mockState: MockState | null = null;

  if (isMockMode()) {
    // Load seed data from fixtures
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const fixturePath = resolve(__dirname, '..', 'fixtures', 'mock-data.json');
    try {
      const raw = readFileSync(fixturePath, 'utf-8');
      const seedData = JSON.parse(raw) as MockSeedData;
      mockState = new MockState(seedData);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        mockState = new MockState();
      } else {
        throw err;
      }
    }
  }

  // Register all tool groups
  registerJiraTools(server, { mockState });
  registerPrTools(server, { mockState });
  registerEnrichTools(server, { mockState });
  registerConfluenceTools(server, { mockState });
  registerSlackTools(server, {
    mockState,
    webhookUrl: process.env.WORKFLOW_SLACK_WEBHOOK,
  });

  // Mock admin tools only in mock mode
  if (mockState) {
    registerMockAdminTools(server, { mockState });
  }

  return server;
}
