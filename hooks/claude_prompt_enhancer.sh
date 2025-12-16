#!/bin/bash

# Read input from stdin
input=$(cat)

# Parse the JSON to extract the prompt
prompt=$(echo "$input" | jq -r '.prompt // empty')

# Enhanced context to inject
additional_context="
- **USE SUBAGENTS**: You MUST subagents for ANY exploration, ANY implementation, or ANY execution. This includes reading or writing files or tailing or grepping logs.
- **Understand first**: Do a quick project‑wide scan; if requirements are ambiguous, ask concise clarifying questions.
- **Plan concurrency**: Map dependencies; run independent steps in parallel; serialize only true blockers.
- **Reason → then Tools**: Reason before acting; **batch calls by default**.
- **Scope control**: Build only what's asked; keep code simple; **enforce YAGNI**.
- **Use memory**: Load only task‑relevant memories/config up front.
- **Verify**: Before declaring any complex, non-trivial task complete e.g. feature or refactor, you need to run npm run verify
"

# Output JSON response with additional context
jq -n \
  --arg decision "approve" \
  --arg context "$additional_context" \
  '{
    decision: $decision,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: $context
    }
  }'


