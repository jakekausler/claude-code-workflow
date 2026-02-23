import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Tests that .mcp.json at the project root is valid and has the expected
 * structure for Claude Code to discover the kanban MCP server.
 */
describe('.mcp.json', () => {
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const mcpJsonPath = path.join(projectRoot, '.mcp.json');

  it('exists at the project root', () => {
    expect(fs.existsSync(mcpJsonPath)).toBe(true);
  });

  it('is valid JSON', () => {
    const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has a kanban server entry with expected command and args', () => {
    const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config).toHaveProperty('mcpServers');
    expect(config.mcpServers).toHaveProperty('kanban');

    const kanban = config.mcpServers.kanban;
    expect(kanban.command).toBe('npx');
    expect(kanban.args).toEqual(['tsx', 'tools/mcp-server/src/index.ts']);
  });

  it('has an env object on the kanban server', () => {
    const raw = fs.readFileSync(mcpJsonPath, 'utf-8');
    const config = JSON.parse(raw);

    expect(config.mcpServers.kanban).toHaveProperty('env');
    expect(typeof config.mcpServers.kanban.env).toBe('object');
  });
});
