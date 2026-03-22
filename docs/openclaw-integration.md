# OpenClaw / G-Man Integration Notes

This document records the intended split between Denx in this repository and the sibling [`openclaw`](../openclaw) workspace.

## Current State

Today this repository already uses OpenClaw for outbound iMessage communication:

- receipt notification when a capture is accepted
- completion notification when processing finishes
- failure notification if processing breaks

The actual knowledge workflow still runs locally inside this repository:

- capture server
- background queue
- warm Whisper worker
- local Codex knowledge agent
- markdown vault writer

## Recommended Ownership Model

Do not let multiple agents write the vault independently.

Recommended split:

- OpenClaw / G-Man:
  - communication surface
  - human-facing chat interface
  - orchestration and routing
  - long-running agent supervision

- Denx:
  - voice ingress
  - text ingress
  - transcription
  - vault-specific reasoning
  - markdown persistence

- Codex knowledge agent:
  - interprets transcript meaning
  - decides note/task/decision/project update shape
  - maintains graph structure in the vault

## Why This Split

- OpenClaw is already strong at messaging and agent control.
- Codex is better suited to the specialized vault-maintenance prompt and markdown reasoning.
- The vault should have one primary writer to avoid duplicate or conflicting note mutations.

## Near-Term Integration Path

1. Keep using OpenClaw for receipt/completion/failure messages.
2. Keep using this repository for direct vault updates.
3. Add a handoff layer so completed captures can also be surfaced to G-Man as structured events.
4. Let G-Man decide whether a capture should trigger additional workflows outside the vault.

## Desired Event Shape

Useful event payload to hand to OpenClaw/G-Man later:

```json
{
  "captureId": "cap_...",
  "device": "iPhone Action Button",
  "capturedAt": "2026-03-21T20:45:00.000Z",
  "transcript": "Reminder to ask Jordan for the Atlas feedback summary tomorrow.",
  "primaryNotePath": "reminders/ask-jordan-for-atlas-feedback-summary.md",
  "taskPaths": [
    "tasks/ask-jordan-for-the-atlas-feedback-summary.md"
  ],
  "status": "completed"
}
```

## Longer-Term Direction

The strongest final shape is:

`voice/text input -> Denx capture queue -> warm Whisper or direct text -> G-Man orchestrator -> Codex knowledge worker -> vault -> OpenClaw reply`

That keeps the user experience unified while still preserving a single vault-writing owner.
