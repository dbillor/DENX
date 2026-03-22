#!/usr/bin/env node

import fs from 'node:fs/promises';
import { Command } from 'commander';

import { createRuntime } from '../lib/runtime.js';

function printTouchedNotes(paths: string[]): void {
  if (!paths.length) {
    return;
  }

  console.log('Touched notes:');
  for (const notePath of paths) {
    console.log(`- ${notePath}`);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('denx')
    .description('Denx knowledge capture and vault manager')
    .version('0.1.0');

  program
    .command('serve')
    .description('Run the HTTP capture endpoint for the iPhone shortcut')
    .action(async () => {
      await import('../server/index.js');
    });

  program
    .command('capture')
    .description('Ingest a local audio file or a direct text capture')
    .option('-f, --file <path>', 'Path to an audio file')
    .option('-t, --text <text>', 'Direct text capture')
    .option('--device <device>', 'Capture device label', 'Local CLI')
    .option('--captured-at <iso>', 'Override capture timestamp')
    .action(async (options) => {
      const runtime = createRuntime();
      await runtime.vault.ensureStructure();

      if (!options.file && !options.text) {
        throw new Error('Provide either --file or --text.');
      }

      const audioBuffer = options.file ? await fs.readFile(options.file) : undefined;
      const result = await runtime.ingestion.ingestCapture({
        audioBuffer,
        audioFileName: options.file,
        transcriptText: options.text,
        device: options.device,
        capturedAt: options.capturedAt,
        sourceKind: options.file ? 'voice' : 'text',
      });

      console.log(result.primaryNote.path);
      console.log(`Transcript: ${result.transcriptPath}`);
      printTouchedNotes(result.taskNotes.map((note) => note.path));
    });

  program
    .command('ask')
    .description('Ask the vault a natural-language question and optionally apply updates')
    .argument('<question...>', 'Question to ask')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (questionParts: string[], options) => {
      const runtime = createRuntime();
      await runtime.vault.ensureStructure();

      const question = questionParts.join(' ');
      const result = await runtime.assistant.ask(question, !options.dryRun);
      console.log(result.answer);
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  program
    .command('organize')
    .description('Ask the agent to tighten links and summaries across recent notes')
    .option('--limit <count>', 'How many recent notes to review', '12')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (options) => {
      const runtime = createRuntime();
      await runtime.vault.ensureStructure();

      const limit = Number(options.limit) || 12;
      const result = await runtime.assistant.organize(limit, !options.dryRun);
      console.log(result.summary);
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  program
    .command('search')
    .description('Search the vault index')
    .argument('<query...>', 'Search query')
    .action(async (queryParts: string[]) => {
      const runtime = createRuntime();
      await runtime.vault.ensureStructure();
      const query = queryParts.join(' ');
      const results = await runtime.vault.search(query, 10);

      for (const result of results) {
        console.log(`${result.path} [${result.type}]`);
        console.log(`  ${result.excerpt}`);
      }
    });

  program
    .command('doctor')
    .description('Validate config, vault folders, and the index')
    .action(async () => {
      const runtime = createRuntime();
      await runtime.vault.ensureStructure();
      await runtime.vault.rebuildIndex();
      const recent = await runtime.vault.getRecentNotes(5);

      console.log(`Vault root: ${runtime.config.vaultRoot}`);
      console.log(`HTTP port: ${runtime.config.port}`);
      console.log(`Agent backend: ${runtime.agentBackend}`);
      console.log(`Transcription backend: ${runtime.transcriptionBackend}`);
      console.log(`OpenAI key: ${runtime.config.openAIApiKey ? 'present' : 'missing'}`);
      console.log(`Agent model: ${runtime.config.agentModel}`);
      console.log(`Reasoning effort: ${runtime.config.reasoningEffort}`);
      console.log(
        `Transcription model: ${
          runtime.transcriptionBackend === 'local-whisper'
            ? runtime.config.localWhisperModel
            : runtime.config.transcriptionModel
        }`,
      );
      console.log(`Indexed notes: ${recent.length ? 'ready' : 'empty vault'}`);
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
