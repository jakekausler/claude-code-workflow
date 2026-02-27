---
title: "Ticket-to-stage conversion session UI"
phase: 11
labels: [feature, ui]
depends_on: [014]
---

# Ticket-to-Stage Conversion Session UI

"Convert" button on to_convert tickets that launches a Claude session in the drawer.

## User Flow

1. User sees a ticket in the to_convert column (has no stages)
2. Clicks "Convert" button on the ticket card or detail drawer
3. If no epic is attached, prompt to select an existing epic or create a new one
4. Claude session launches in the drawer (using existing session viewer infrastructure)
5. Session creates stage files based on ticket content
6. Stages appear on the board as they are created
7. Ticket moves out of to_convert once stages exist

## Requirements

- "Convert" button visible on to_convert ticket cards and in ticket detail drawer
- Epic selection/creation modal when epic is missing
- Session launches via orchestrator (reuses stage 10 bidirectional interaction)
- Session viewer in drawer shows real-time progress
- Board updates via SSE as stages are created

## Technical Notes

- Leverages existing 10B bidirectional interaction and 10E drawer session integration
- The orchestrator already handles spawning Claude sessions for stage work
- This adds a UI trigger for the conversion flow specifically
