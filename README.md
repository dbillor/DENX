# Denx

Denx turns raw voice and text into a living personal knowledge system.

Press one button on your iPhone, speak naturally, and Denx does the rest:

- captures the audio
- transcribes it locally on your Mac
- routes it through a Codex scribe
- updates a structured Obsidian-compatible vault
- grows durable memory for projects, people, systems, and recurring ideas
- sends confirmation back through OpenClaw

The point is not to collect more voice memos. The point is to turn fleeting thoughts into a knowledge graph that keeps getting smarter, more connected, and more useful over time.

## Why Denx Is Different

Most voice capture tools stop at transcription. Denx does not.

Denx is built to act like a local knowledge operator:

- not a transcript dump
- not a thin note-taking shortcut
- not a cloud-only chatbot with no durable memory

It is a local-first scribe system that can:

- turn spoken or typed input into notes, tasks, decisions, reminders, and project updates
- strengthen canonical memory for the people, systems, and projects that matter repeatedly
- keep raw provenance without letting transcripts become the main artifact
- sync the resulting vault privately across devices

If you want an external brain that lives in markdown, works with Obsidian, and is powered by local tools on your own machine, this is what Denx is for.

## Repository Boundary

This repository is intended to contain the Denx service code and documentation only.

It should **not** publish:

- the live `vault/` knowledge base
- local `_memory` content
- raw transcripts or audio captures
- `.env`
- local logs and temp files
- private source papers kept only for local reference

The default `.gitignore` is configured so those local assets stay off GitHub.

## What It Does

- Accepts voice or text captures through explicit HTTP endpoints.
- Returns immediately from the HTTP endpoint and processes captures in the background.
- Supports two capture paths:
  - Raw audio upload -> local Whisper-class transcription on your Mac.
  - Direct text ingress -> local Codex CLI on your Mac.
- Uses a high-agency agent to classify each input as a `note`, `task`, `decision`, `reminder`, or `project-update`.
- Writes durable markdown into an Obsidian-style vault instead of dumping raw transcripts into one folder.
- Creates links, tags, related notes, backlinks, daily-log entries, and follow-up task notes automatically.
- Can strengthen canonical notes for people, projects, systems, and topics when a capture adds durable context.
- Can append durable owner-level memory into `_memory/` for identity, preferences, principles, and open questions.
- Sends iMessage receipt/completion/failure notifications through OpenClaw.
- Exposes a CLI for capture, search, natural-language ask/update, and organization passes.

## Current Status

This is the current working architecture in this repository:

- iPhone Shortcut records raw audio.
- Shortcut uploads the audio to `POST /api/captures/voice`.
- The server accepts the request immediately with `202 Accepted`.
- A local background queue processes the capture on the Mac.
- A warm resident `faster-whisper` worker keeps the transcription model loaded in memory.
- Local Codex shapes the transcript into durable markdown.
- The vault is updated directly on disk.
- OpenClaw sends iMessage updates back to the owner.

Current local defaults:

- HTTP port: `8787`
- Transcription backend: local `faster-whisper`
- Whisper model: `large-v3`
- Whisper worker mode: prewarmed resident process
- Agent backend: local Codex CLI
- Notification channel: OpenClaw iMessage

## Private Cloud Sync

This repository is now configured for always-on private online sync using Obsidian Headless.

Recommended model:

- this Mac remains the source-of-truth writer
- Headless Sync runs continuously in the background on this Mac
- the remote vault is `Personal Operating System`
- other Macs/iPhones/iPads use normal Obsidian Sync to open the same remote vault

Important rule from Obsidian's docs:

- do **not** use the desktop app's Sync plugin and Headless Sync on the same Mac at the same time

Setup guide:

- [docs/obsidian-sync.md](docs/obsidian-sync.md)
- [docs/system-design.md](docs/system-design.md)
- [docs/agent-storage-policy.md](docs/agent-storage-policy.md)

## Architecture

```mermaid
flowchart LR
  A["iPhone Shortcut / Action Button"] --> B["POST /api/captures/voice"]
  A2["Text sender / agent"] --> B2["POST /api/captures/text"]
  B --> C["Immediate 202 Accepted"]
  B2 --> C
  B --> D["Background capture queue"]
  B2 --> D
  D --> E["Warm local Whisper worker"]
  E --> F["Local Codex knowledge agent"]
  F --> G["Vault writer"]
  G --> H["Obsidian markdown vault"]
  D --> I["OpenClaw receipt / completion / failure iMessages"]
```

### Ownership Split

- Whisper owns speech-to-text.
- Codex owns vault reasoning and note shaping.
- The vault writer owns markdown persistence.
- OpenClaw owns communication back to the user.

This split is intentional. Only one component should write the vault. OpenClaw is the communication and orchestration surface, not the primary markdown editor.

## Vault Layout

```text
vault/
  daily/
  decisions/
  notes/
  projects/
    updates/
  reminders/
  tasks/
  _memory/
    people/
    projects/
    systems/
    topics/
  _system/
    audio/
    index.json
    transcripts/
```

Each knowledge note gets frontmatter plus managed `## Related` and `## Backlinks` sections so the vault compounds over time.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Make sure local Codex is ready:

   ```bash
   codex login status
   ```

4. The project defaults to local audio transcription on your Mac using `faster-whisper`.
   The first audio transcription will download the selected Whisper model.

5. Check local config:

   ```bash
   npx tsx src/cli/index.ts doctor
   ```

6. Start the capture server:

   ```bash
   npm run dev:server
   ```

7. For production iPhone use:
   - keep the Shortcut minimal
   - let OpenClaw send confirmations by iMessage
   - remove `Quick Look` once debugging is finished so the Action Button flow stays quiet

## CLI Commands

Run through `npx tsx src/cli/index.ts <command>` during development, or alias it to `denx`.

- `doctor`
  Validates config, creates the vault folders, and builds the search index.
- `capture --file /path/to/memo.m4a`
  Local smoke test for the raw audio path using local Whisper transcription.
- `capture --text "Remember to message Sam about the Atlas launch plan"`
  Sends a text capture through the same shaping pipeline using local Codex if available.
- `search "atlas launch"`
  Searches the local markdown graph index.
- `ask "What decisions have I made about Atlas this week?"`
  Reads the vault, answers in natural language, and applies additive note updates when helpful.
- `organize --limit 12`
  Runs an organization pass across recent notes to tighten links and summaries.

## Capture Flow

```mermaid
flowchart LR
  A["iPhone Shortcut"] --> B["POST /api/captures/voice"]
  A2["Text sender / agent"] --> B2["POST /api/captures/text"]
  B --> C["202 Accepted"]
  B2 --> C
  B --> D["Background queue"]
  B2 --> D
  D --> E["Raw audio upload"]
  D --> F["Text fallback"]
  E --> G["Warm local Whisper transcription"]
  F --> H["Local Codex CLI agent"]
  G --> H
  H --> I["Vault writer"]
  I --> J["Markdown notes + tasks"]
  I --> K["Backlinks + graph index"]
  D --> L["OpenClaw iMessage notifications"]
  M["CLI ask / organize"] --> I
```

## iPhone Shortcut

Full setup guide: [docs/iphone-shortcut.md](docs/iphone-shortcut.md)

Local Codex architecture and prompt: [docs/local-codex-assistant.md](docs/local-codex-assistant.md)

OpenClaw / G-Man integration notes: [docs/openclaw-integration.md](docs/openclaw-integration.md)

Obsidian Sync / always-online setup: [docs/obsidian-sync.md](docs/obsidian-sync.md)

Full architecture record: [docs/system-design.md](docs/system-design.md)

Agent storage policy: [docs/agent-storage-policy.md](docs/agent-storage-policy.md)

The Shortcut should:

1. Preferred version: record raw audio on iPhone.
2. Send the audio file to `POST /api/captures/voice`.
3. Include `Authorization: Bearer <CAPTURE_API_TOKEN>`.
4. Optionally include `capturedAt` and `device`.
5. During setup, optionally show the accepted JSON response.
6. For production Action Button use, remove `Quick Look` and rely on OpenClaw iMessage updates instead.

## 1-Button iPhone Scribe Setup

The intended production UX is:

- press the iPhone Action Button
- record a short memo
- upload the audio directly to Denx on your Mac
- let Denx queue the job immediately
- receive iMessage receipt/completion updates from OpenClaw

Use this Shortcut shape:

1. `Record Audio`
   - Quality: High
   - Stop Listening: `On Tap` or the least-interactive stop mode your iPhone exposes
2. `Current Date`
3. Optional: `Format Date`
4. `Get Contents of URL`
   - URL: `http://YOUR-MAC-IP-OR-TAILSCALE-HOST:8787/api/captures/voice`
   - Method: `POST`
   - Request Body: `File`
   - File: `Recorded Audio`
5. Add headers:
   - `Authorization: Bearer YOUR_CAPTURE_API_TOKEN`
   - `X-Device: iPhone Action Button`
   - `X-Captured-At: <Current Date or formatted date>`
   - `X-File-Name: capture.m4a`
6. Optional during setup only: `Quick Look`

Then bind it on iPhone:

1. `Settings`
2. `Action Button`
3. Choose `Shortcut`
4. Select your Denx voice-capture shortcut

For anywhere access:

- install Tailscale on the Mac and iPhone
- sign into the same Tailscale account
- swap the Shortcut URL from local LAN IP to the Mac's Tailscale IP or MagicDNS hostname

## OpenClaw / G-Man Direction

The recommended long-term architecture is:

- OpenClaw/G-Man is the front door and communication surface.
- This repository remains the local voice capture and knowledge-vault subsystem.
- OpenClaw receives receipt/completion/failure events and can later become the orchestrator that routes captures into additional workers.
- Codex remains the specialist knowledge worker that reads and updates the vault.

This avoids split ownership of the vault while still letting OpenClaw do much more than messaging over time. Denx is the named knowledge-capture subsystem on the Mac.

Current integration level:

- OpenClaw is already used for outbound iMessage notifications.
- A fuller orchestration integration with the sibling [`openclaw`](../openclaw) workspace is a documented next step, not yet the primary execution path.

## Test

```bash
npm run build
npm test
```

## Notes

- If `OPENAI_API_KEY` is absent, the project now falls back to local Codex CLI for the agent layer.
- Raw audio upload now defaults to local `faster-whisper` transcription on this Mac.
- The Whisper model is now kept warm in a resident worker process, so repeated captures avoid per-request model load.
- The first server boot can still take materially longer because the Whisper model is downloaded and initialized.
- OpenClaw is configured to send receipt/completion/failure notifications when `OPENCLAW_NOTIFY_TARGET` is set.
- The `_system/transcripts/` folder keeps the raw transcript available without letting it become the main knowledge surface.
