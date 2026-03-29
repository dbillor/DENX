import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
import type { CapturePlan } from '../agent/schemas.js';
import type { KnowledgeAgentClient } from '../agent/types.js';
import { VaultStore } from '../vault/VaultStore.js';
import { IngestionService } from './IngestionService.js';

const tempDirs: string[] = [];

async function createTempVault(): Promise<VaultStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'denx-test-'));
  tempDirs.push(directory);
  return new VaultStore(directory, 'America/Los_Angeles');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

function createConfig(workspaceRoot: string, vaultRoot: string): AppConfig {
  return {
    workspaceRoot,
    vaultRoot,
    port: 8787,
    agentModel: 'gpt-5.2',
    transcriptionBackend: 'local-whisper',
    transcriptionModel: 'gpt-4o-mini-transcribe',
    localWhisperModel: 'large-v3',
    localWhisperComputeType: 'int8',
    localWhisperDevice: 'cpu',
    localWhisperPython: '.venv/bin/python',
    localWhisperCpuThreads: 8,
    reasoningEffort: 'xhigh',
    maxUploadMb: 25,
    timeZone: 'America/Los_Angeles',
  };
}

describe('IngestionService', () => {
  it('propagates durable subject and memory updates during capture ingestion', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();

    const plan: CapturePlan = {
      classification: 'decision',
      title: 'Denx routing boundary',
      summary: 'Keep OpenClaw on orchestration and keep the scribe worker as the single writer.',
      note_markdown: [
        '# Denx routing boundary',
        '',
        '## Decision',
        'Keep OpenClaw on orchestration and keep the scribe worker as the single writer.',
      ].join('\n'),
      canonical_tags: ['denx', 'orchestration'],
      aliases: [],
      related_subjects: [
        { title: 'Denx', relation: 'project', entity_type: 'project', create_if_missing: true },
        { title: 'OpenClaw', relation: 'system', entity_type: 'system', create_if_missing: true },
        { title: 'Satya', relation: 'person', entity_type: 'person', create_if_missing: true },
        { title: 'Autonomous Task Horizon', relation: 'topic', entity_type: 'topic', create_if_missing: true },
      ],
      action_items: [],
      subject_updates: [
        {
          title: 'Denx',
          entity_type: 'project',
          section: 'Operating Model',
          markdown: '- OpenClaw owns orchestration while the scribe worker owns vault mutation.',
        },
        {
          title: 'OpenClaw',
          entity_type: 'system',
          section: 'Role',
          markdown: '- OpenClaw is the orchestration and messaging surface for Denx.',
        },
        {
          title: 'Satya',
          entity_type: 'person',
          section: 'Context',
          markdown: '- Satya is part of the executive audience for the current Denx narrative.',
        },
      ],
      memory_updates: [
        {
          target: 'preferences',
          section: 'Vault Stewardship',
          markdown: '- Prefer canonical project and system notes to stay current.',
        },
        {
          target: 'open-questions',
          section: 'Orchestration',
          markdown: '- Should G-Man eventually become the default orchestrator for Denx captures?',
        },
      ],
      follow_ups: [],
      status: 'decided',
      project: 'Denx',
      reminder_time_hint: undefined,
      should_append_to_daily: true,
    };

    const agent: KnowledgeAgentClient = {
      async shapeCapture() {
        return plan;
      },
      async answerAsk() {
        throw new Error('not used');
      },
      async organize() {
        throw new Error('not used');
      },
    };

    const ingestion = new IngestionService(
      vault,
      agent,
      null,
      {
        async notifyCaptureProcessed() {},
      } as never,
      createConfig(process.cwd(), vault.vaultRoot),
    );

    const result = await ingestion.ingestCapture({
      transcriptText:
        'OpenClaw should orchestrate Denx, the scribe worker should own vault writes, Satya is an audience member, and canonical notes should stay current.',
      sourceKind: 'text',
      device: 'test',
      capturedAt: '2026-03-22T12:00:00-07:00',
    });

    expect(result.primaryNote.path).toBe('decisions/denx-routing-boundary.md');
    expect(result.subjectNotes.length).toBeGreaterThanOrEqual(3);
    expect(result.memoryNotes.length).toBe(2);

    const denxProject = await vault.load('projects/denx.md');
    const openclawSystem = await vault.load('_memory/systems/openclaw.md');
    const satyaPerson = await vault.load('_memory/people/satya.md');
    const preferences = await vault.load('_memory/preferences.md');
    const openQuestions = await vault.load('_memory/open-questions.md');

    expect(denxProject.content).toContain('OpenClaw owns orchestration');
    expect(openclawSystem.content).toContain('orchestration and messaging surface for Denx');
    expect(satyaPerson.content).toContain('executive audience');
    expect(preferences.content).toContain('Prefer canonical project and system notes to stay current');
    expect(openQuestions.content).toContain('default orchestrator for Denx captures');
  });
});
