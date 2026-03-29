import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
import { VaultStore } from '../vault/VaultStore.js';
import { DocumentIngestionService } from './DocumentIngestionService.js';

const tempDirs: string[] = [];

async function createTempVault(): Promise<VaultStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'denx-doc-test-'));
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

describe('DocumentIngestionService', () => {
  it('copies text documents into provenance and sends extracted content through the scribe path', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();
    const workspace = path.dirname(vault.vaultRoot);
    const sourceFile = path.join(workspace, 'brief.txt');
    await fs.writeFile(sourceFile, 'Atlas depends on Denx and Jordan owns the launch checklist.\n', 'utf8');

    const note = await vault.createNote({
      title: 'Atlas brief',
      type: 'note',
      body: '# Atlas brief\n\nAtlas depends on Denx.',
    });

    const service = new DocumentIngestionService(
      vault,
      {
        async runTask() {
          return {
            summary: 'Updated Atlas knowledge from the imported brief.',
            diffSummary: 'Summary: Atlas brief import',
            warnings: [],
            plan: {
              summary: 'Updated Atlas knowledge from the imported brief.',
              confidence: 'high',
              sources: [],
              notes_considered: [],
              commit_summary: 'Imported document',
              actions: [],
            },
            touchedNotes: [note],
          };
        },
      } as never,
      createConfig(workspace, vault.vaultRoot),
    );

    const result = await service.ingestDocument(sourceFile, {
      capturedAt: '2026-03-29T11:00:00-07:00',
      title: 'Atlas brief',
    });

    expect(result.extractionFailed).toBe(false);
    expect(result.sourcePath).toContain('_system/sources/docs/2026-03-29/');
    expect(result.extractionPath).toContain('_system/extractions/docs/2026-03-29/');

    const copiedSource = await fs.readFile(path.join(vault.vaultRoot, result.sourcePath), 'utf8');
    expect(copiedSource).toContain('Jordan owns the launch checklist');

    const extraction = await vault.load(result.extractionPath);
    expect(extraction.content).toContain('Atlas depends on Denx');
  });

  it('records provenance and failure state when extraction cannot produce text', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();
    const workspace = path.dirname(vault.vaultRoot);
    const sourceFile = path.join(workspace, 'broken.pdf');
    await fs.writeFile(sourceFile, 'not a real pdf', 'utf8');

    const service = new DocumentIngestionService(
      vault,
      {
        async runTask() {
          throw new Error('runTask should not be called for failed extraction');
        },
      } as never,
      createConfig(workspace, vault.vaultRoot),
    );

    const result = await service.ingestDocument(sourceFile, {
      capturedAt: '2026-03-29T11:05:00-07:00',
    });

    expect(result.extractionFailed).toBe(true);
    expect(result.touchedNotes).toHaveLength(0);

    const extraction = await vault.load(result.extractionPath);
    expect(extraction.content).toContain('Status: failed');
  });
});
