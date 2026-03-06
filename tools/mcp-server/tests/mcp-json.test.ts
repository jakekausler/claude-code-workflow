import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Tests that the MCP config at the project root is valid and has the expected
 * structure for Claude Code to discover the kanban MCP server.
 *
 * Resolution order:
 *   1. .mcp.json       — local config created by running scripts/install.sh (gitignored)
 *   2. .mcp.json.example — committed template; always present in the repo
 *
 * A fresh clone (before running install.sh) will test .mcp.json.example.
 * After running install.sh, .mcp.json is created and takes precedence.
 */
describe('.mcp.json', () => {
  const projectRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const mcpJsonPath = (() => {
    const localPath = path.join(projectRoot, '.mcp.json');
    const examplePath = path.join(projectRoot, '.mcp.json.example');
    return fs.existsSync(localPath) ? localPath : examplePath;
  })();

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
