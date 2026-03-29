# Agent Storage Policy

This document records what the knowledge agent is expected to preserve, what it should avoid preserving, and how it should map new information into the vault.

## Objective

The agent should not behave like a transcript archive. It should behave like a selective long-term knowledge steward.

Its standard is:

- preserve durable information
- reduce noise
- improve retrieval
- maintain a coherent knowledge graph over time

## What The Agent Should Store

The agent should preserve information that will matter later, including:

- project goals, scope, architecture, status, blockers, and milestones
- design ideas worth revisiting
- system architecture and operating rules
- decisions, tradeoffs, rationale, and approvals
- explicit tasks, follow-ups, reminders, and commitments
- recurring people, roles, and relationship context
- recurring systems, tools, assistants, and infrastructure references
- open questions and unresolved risks that affect future work
- stable reference information that future reasoning depends on

## What The Agent Should Not Promote

The agent should avoid creating durable first-class notes for:

- greetings and playful banter
- conversational filler
- accidental captures
- low-context fragments with no clear subject
- raw transcript phrasing when a clean summary is enough

Raw captures still matter, but they belong in provenance, not in the main knowledge surface.

## Provenance Versus Knowledge

The system keeps two layers:

- durable knowledge in the main vault
- provenance in `_system`

Use `_system` for:

- source audio
- raw transcripts
- machine-generated supporting state

Use the main vault for:

- notes
- tasks
- reminders
- decisions
- projects
- project updates
- `_memory`
- daily links into durable notes

## Folder-Level Intent

- `projects/`
  - canonical project notes and project dossiers
  - current architecture, operating model, stable project context
- `projects/updates/`
  - progress history, milestones, implementation changes, setup updates
- `decisions/`
  - durable architectural or operational decisions with rationale
- `tasks/`
  - explicit follow-up work
- `reminders/`
  - time-sensitive nudges
- `notes/`
  - evergreen notes, design ideas, topic notes, people notes, system notes, reusable references
- `_memory/`
  - stable personal memory that should persist across many future interactions
  - identity, preferences, principles, open questions, and long-lived people/project/system memory
- `daily/`
  - lightweight chronological log entries that point to more durable notes

## Promotion Rules

When information repeats or compounds, the agent should promote it into stronger structure.

Examples:

- repeated project state -> strengthen the canonical project note
- repeated people context -> strengthen the canonical person memory note
- repeated system architecture or operating rules -> strengthen the canonical system memory note
- repeated durable topic framing -> strengthen the canonical topic note
- major implementation milestone -> log a project update
- clarified operating rule -> record a decision
- recurring assistant/tool/system identity -> create or update a durable reference note
- design direction with future reuse -> create or enrich an evergreen note

## Capture Pipeline Growth

The capture pipeline should not only create a primary note. When the current capture materially improves a durable subject, the agent should also update the relevant canonical note for:

- people
- projects
- systems
- topics

When the capture reveals stable owner-level context, the agent may also append to `_memory/`:

- `identity.md`
- `preferences.md`
- `principles.md`
- `open-questions.md`

This should happen only for durable context, not for routine project chatter or transient details.

## Architecture And System Work

When the user is describing architecture or workflow, the agent should preserve:

- the design itself
- why it exists
- what changed
- responsibility boundaries
- what is already working
- what remains unfinished

That information should usually become:

- a project update
- a decision note
- a task if unfinished work is implied
- an update to the canonical project note

## Personal Brain Direction

For the long-term external-brain goal, the agent should prefer:

- fewer, stronger canonical notes
- stable project and system hubs
- linked decisions with rationale
- explicit task extraction
- durable summaries over transcript dumps

The vault should compound into a knowledge graph that stays readable by a human, not just processable by a machine.
