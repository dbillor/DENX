import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../config.js';
import { VaultStore } from '../vault/VaultStore.js';
import { KnowledgeCliService } from './KnowledgeCliService.js';

const tempDirs: string[] = [];

async function createTempVault(): Promise<VaultStore> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'denx-cli-test-'));
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

describe('KnowledgeCliService', () => {
  it('refuses to mutate protected provenance paths', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();
    const config = createConfig(process.cwd(), vault.vaultRoot);
    const cli = new KnowledgeCliService(vault, config);

    const warnings = cli.validatePlan({
      summary: 'Invalid provenance mutation',
      confidence: 'high',
      sources: [],
      notes_considered: [],
      commit_summary: 'Should be blocked',
      actions: [
        {
          type: 'archive_note',
          target: '_system/transcripts/2026-03-29/cap_1.md',
        },
      ],
    });

    expect(warnings[0]).toContain('protected provenance path');
  });

  it('merges duplicate notes and archives the source note instead of deleting it', async () => {
    const vault = await createTempVault();
    await vault.ensureStructure();
    const config = createConfig(process.cwd(), vault.vaultRoot);
    const cli = new KnowledgeCliService(vault, config);

    const target = await vault.createNote({
      title: 'Denx thesis',
      type: 'note',
      body: '# Denx thesis\n\nCore Denx idea.',
    });
    const source = await vault.createNote({
      title: 'Denx thesis duplicate',
      type: 'note',
      body: '# Denx thesis duplicate\n\nOlder duplicate draft.',
    });

    const result = await cli.executePlan({
      summary: 'Merge duplicate Denx thesis notes',
      confidence: 'high',
      sources: [],
      notes_considered: [target.path, source.path],
      commit_summary: 'Merged duplicate note',
      actions: [
        {
          type: 'merge_notes',
          target: target.path,
          sources: [source.path],
          summary: 'Consolidate the duplicate draft into the canonical note.',
          archive_sources: true,
        },
      ],
    });

    expect(result.touchedNotes.length).toBeGreaterThanOrEqual(2);

    const mergedTarget = await vault.load(target.path);
    const archivedSource = await vault.load(source.path);

    expect(mergedTarget.content).toContain('Merged Context');
    expect(mergedTarget.content).toContain('Older duplicate draft.');
    expect(archivedSource.frontmatter.status).toBe('archived');
    expect(archivedSource.content).toContain('Archive History');
  });
});
