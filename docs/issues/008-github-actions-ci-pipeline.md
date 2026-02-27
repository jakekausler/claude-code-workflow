---
title: "GitHub Actions CI pipeline"
phase: 11
labels: [infrastructure, ci]
depends_on: []
---

# GitHub Actions CI Pipeline

Automated PR checks across all tools in the monorepo.

## Requirements

- Run on every PR targeting `main`
- Lint, typecheck, and test all four tools: kanban-cli, web-server, orchestrator, mcp-server
- Use the existing `npm run verify` where available
- Branch protection rules requiring CI pass before merge
- Cache node_modules for faster runs

## Pipeline Steps

1. Checkout + Node.js setup
2. Install dependencies (per tool)
3. Lint (ESLint)
4. Type check (tsc --noEmit)
5. Test (vitest run)
6. Build verification (where applicable)

## Considerations

- Monorepo structure means each tool has its own package.json and test config
- Consider matrix strategy to run tools in parallel
- Keep total CI time under 5 minutes
