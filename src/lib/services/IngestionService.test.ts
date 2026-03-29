import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
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
  it('records provenance and forwards capture work to the unified scribe path', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();

    const decisionNote = await vault.createNote({
      title: 'Denx routing boundary',
      type: 'decision',
      body: [
        '# Denx routing boundary',
        '',
        '## Decision',
        'Keep OpenClaw on orchestration and keep the scribe worker as the single writer.',
      ].join('\n'),
      tags: ['denx', 'orchestration'],
      status: 'decided',
    });

    const projectNote = await vault.ensureSubject({ title: 'Denx', kind: 'project' });
    const personNote = await vault.ensureSubject({ title: 'Satya', kind: 'person' });
    await vault.appendToMemory('preferences', 'Purpose', '- Prefer canonical notes when possible.');
    const preferencesNote = await vault.load('_memory/preferences.md');

    const assistant = {
      async runTask() {
        return {
          summary: 'Keep OpenClaw on orchestration and keep the scribe worker as the single writer.',
          diffSummary: 'Summary: Denx routing boundary',
          warnings: [],
          plan: {
            summary: 'Keep OpenClaw on orchestration and keep the scribe worker as the single writer.',
            confidence: 'high',
            sources: [],
            notes_considered: [],
            commit_summary: 'Recorded routing boundary',
            actions: [],
          },
          touchedNotes: [decisionNote, projectNote, personNote, preferencesNote],
        };
      },
    } as const;

    const ingestion = new IngestionService(
      vault,
      assistant as never,
      null,
      {
        async notifyCaptureProcessed() {},
      } as never,
      createConfig(process.cwd(), vault.vaultRoot),
    );

    const result = await ingestion.ingestCapture({
      transcriptText:
        'OpenClaw should orchestrate Denx, the scribe worker should own vault writes, and Satya is part of the audience.',
      sourceKind: 'text',
      device: 'test',
      capturedAt: '2026-03-22T12:00:00-07:00',
    });

    expect(result.primaryNote?.path).toBe('decisions/denx-routing-boundary.md');
    expect(result.subjectNotes.length).toBeGreaterThanOrEqual(1);
    expect(result.subjectNotes.some((note) => note.path.startsWith('_memory/people/'))).toBe(true);
    expect(result.memoryNotes.some((note) => note.path === '_memory/preferences.md')).toBe(true);

    const transcript = await vault.load(result.transcriptPath);
    expect(transcript.content).toContain('OpenClaw should orchestrate Denx');
  });
});
