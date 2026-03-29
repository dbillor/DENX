#!/usr/bin/env node

import fs from 'node:fs/promises';
import { Command } from 'commander';

import { scribePlanSchema, type ScribePlan } from '../lib/agent/schemas.js';
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

function parseCsv(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadPlan(pathValue: string): Promise<ScribePlan> {
  const raw = await fs.readFile(pathValue, 'utf8');
  return scribePlanSchema.parse(JSON.parse(raw));
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('denx')
    .description('Denx knowledge capture, scribe, and vault manager')
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

      console.log(result.primaryNote?.path ?? '(no primary note)');
      console.log(`Transcript: ${result.transcriptPath}`);
      printTouchedNotes(result.taskNotes.map((note) => note.path));
    });

  program
    .command('task')
    .description('Run a task-driven knowledge request through the v3 scribe path')
    .argument('<prompt...>', 'Task prompt')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (promptParts: string[], options) => {
      const runtime = createRuntime();
      const prompt = promptParts.join(' ');
      const result = await runtime.assistant.runTask(
        {
          mode: 'task',
          requestText: prompt,
          sourceKind: 'text',
          sourceRefs: [{ kind: 'query', path: prompt, label: 'CLI task' }],
        },
        !options.dryRun,
      );

      console.log(result.summary);
      console.log(result.diffSummary);
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  program
    .command('maintain')
    .description('Run maintenance work through the v3 scribe path')
    .option('--scope <scope>', 'Maintenance scope', 'recent notes and canonical hubs')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (options) => {
      const runtime = createRuntime();
      const result = await runtime.assistant.runTask(
        {
          mode: 'maintenance',
          requestText: `Perform maintenance on ${options.scope}. Merge duplicates, strengthen hubs, and improve graph quality where useful.`,
          sourceKind: 'text',
          sourceRefs: [{ kind: 'query', path: `maintenance:${options.scope}`, label: 'Maintenance' }],
        },
        !options.dryRun,
      );

      console.log(result.summary);
      console.log(result.diffSummary);
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  const ingest = program.command('ingest').description('Ingest source materials into Denx');

  ingest
    .command('doc')
    .description('Ingest Markdown, text, or PDF documents')
    .argument('<paths...>', 'Document paths')
    .option('--project <project>', 'Project name')
    .option('--tags <csv>', 'Comma-separated tags')
    .option('--title <title>', 'Override title for single-document ingest')
    .option('--captured-at <iso>', 'Override capture timestamp')
    .action(async (paths: string[], options) => {
      const runtime = createRuntime();
      for (const inputPath of paths) {
        const result = await runtime.documentIngestion.ingestDocument(inputPath, {
          project: options.project,
          tags: parseCsv(options.tags),
          title: paths.length === 1 ? options.title : undefined,
          capturedAt: options.capturedAt,
        });

        console.log(`Source: ${result.sourcePath}`);
        console.log(`Extraction: ${result.extractionPath}`);
        if (result.extractionFailed) {
          console.log('Extraction failed or returned no text; provenance was preserved.');
          continue;
        }
        console.log(result.plan?.summary ?? 'Document ingested.');
        printTouchedNotes(result.touchedNotes.map((note) => note.path));
      }
    });

  program
    .command('ask')
    .description('Ask the vault a natural-language question and optionally apply updates')
    .argument('<question...>', 'Question to ask')
    .option('--dry-run', 'Preview without applying changes')
    .action(async (questionParts: string[], options) => {
      const runtime = createRuntime();
      const question = questionParts.join(' ');
      const result = await runtime.assistant.ask(question, !options.dryRun);
      console.log(result.answer);
      console.log(result.diffSummary);
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
      const limit = Number(options.limit) || 12;
      const result = await runtime.assistant.organize(limit, !options.dryRun);
      console.log(result.summary);
      console.log(result.diffSummary);
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
      const results = await runtime.knowledgeCli.search(query, 10);

      for (const result of results) {
        console.log(`${result.path} [${result.type}]`);
        console.log(`  ${result.excerpt}`);
      }
    });

  const kb = program.command('kb').description('Low-level Denx knowledge CLI actions');

  kb
    .command('search')
    .argument('<query...>')
    .action(async (queryParts: string[]) => {
      const runtime = createRuntime();
      const results = await runtime.knowledgeCli.search(queryParts.join(' '), 10);
      for (const result of results) {
        console.log(`${result.path} [${result.type}]`);
        console.log(`  ${result.excerpt}`);
      }
    });

  kb
    .command('read')
    .argument('<reference>')
    .action(async (reference: string) => {
      const runtime = createRuntime();
      const note = await runtime.knowledgeCli.read(reference);
      console.log(`${note.path} [${note.type}]`);
      console.log(note.content);
    });

  kb
    .command('related')
    .argument('<reference>')
    .action(async (reference: string) => {
      const runtime = createRuntime();
      const related = await runtime.knowledgeCli.related(reference);
      console.log(`Note: ${related.note.path}`);
      console.log('Outgoing:');
      for (const item of related.outgoing) {
        console.log(`- ${item.path}`);
      }
      console.log('Incoming:');
      for (const item of related.incoming) {
        console.log(`- ${item.path}`);
      }
    });

  kb
    .command('diff-plan')
    .argument('<planFile>')
    .action(async (planFile: string) => {
      const runtime = createRuntime();
      const plan = await loadPlan(planFile);
      console.log(runtime.knowledgeCli.diffPlan(plan));
      const warnings = runtime.knowledgeCli.validatePlan(plan);
      if (warnings.length) {
        console.log('Warnings:');
        for (const warning of warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  kb
    .command('commit-plan')
    .argument('<planFile>')
    .action(async (planFile: string) => {
      const runtime = createRuntime();
      const plan = await loadPlan(planFile);
      const result = await runtime.knowledgeCli.executePlan(plan);
      await runtime.vault.refreshKnowledgeGraph();
      console.log(result.diffSummary);
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
      if (result.warnings.length) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
          console.log(`- ${warning}`);
        }
      }
    });

  kb
    .command('create-note')
    .requiredOption('--type <type>')
    .requiredOption('--title <title>')
    .requiredOption('--from-file <path>')
    .option('--tags <csv>')
    .option('--aliases <csv>')
    .option('--project <project>')
    .option('--folder <folder>')
    .action(async (options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Create note ${options.title}`,
        confidence: 'high',
        sources: [],
        notes_considered: [],
        commit_summary: `Created ${options.type} ${options.title}`,
        actions: [
          {
            type: 'create_note',
            note: {
              note_type: options.type,
              title: options.title,
              markdown,
              tags: parseCsv(options.tags),
              aliases: parseCsv(options.aliases),
              related_subjects: [],
              project: options.project,
              folder_hint: options.folder,
            },
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('update-note')
    .argument('<target>')
    .requiredOption('--from-file <path>')
    .option('--title <title>')
    .option('--tags <csv>')
    .option('--aliases <csv>')
    .option('--project <project>')
    .action(async (target: string, options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Update ${target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [target],
        commit_summary: `Updated ${target}`,
        actions: [
          {
            type: 'update_note',
            target,
            markdown,
            title: options.title,
            tags: parseCsv(options.tags),
            aliases: parseCsv(options.aliases),
            related_subjects: [],
            project: options.project,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('append-section')
    .argument('<target>')
    .requiredOption('--section <section>')
    .requiredOption('--from-file <path>')
    .action(async (target: string, options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Append section ${options.section} to ${target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [target],
        commit_summary: `Appended ${options.section} to ${target}`,
        actions: [
          {
            type: 'append_to_note',
            target,
            section: options.section,
            markdown,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('merge-notes')
    .argument('<target>')
    .argument('<sources...>')
    .option('--summary <summary>')
    .action(async (target: string, sources: string[], options) => {
      const runtime = createRuntime();
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Merge notes into ${target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [target, ...sources],
        commit_summary: `Merged notes into ${target}`,
        actions: [
          {
            type: 'merge_notes',
            target,
            sources,
            summary: options.summary,
            archive_sources: true,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('link-notes')
    .argument('<source>')
    .argument('<target>')
    .option('--relation <relation>')
    .action(async (source: string, target: string, options) => {
      const runtime = createRuntime();
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Link ${source} to ${target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [source, target],
        commit_summary: `Linked ${source} to ${target}`,
        actions: [
          {
            type: 'link_notes',
            source,
            target,
            relation: options.relation,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('archive-note')
    .argument('<target>')
    .option('--reason <reason>')
    .action(async (target: string, options) => {
      const runtime = createRuntime();
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Archive ${target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [target],
        commit_summary: `Archived ${target}`,
        actions: [
          {
            type: 'archive_note',
            target,
            reason: options.reason,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('record-memory')
    .requiredOption('--target <target>')
    .requiredOption('--section <section>')
    .requiredOption('--from-file <path>')
    .action(async (options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Record memory in ${options.target}`,
        confidence: 'high',
        sources: [],
        notes_considered: [],
        commit_summary: `Recorded memory in ${options.target}`,
        actions: [
          {
            type: 'record_memory',
            target: options.target,
            section: options.section,
            markdown,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('record-document')
    .requiredOption('--title <title>')
    .requiredOption('--source-path <path>')
    .requiredOption('--from-file <path>')
    .option('--extracted-path <path>')
    .option('--tags <csv>')
    .option('--project <project>')
    .action(async (options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Record document ${options.title}`,
        confidence: 'high',
        sources: [options.sourcePath, options.extractedPath].filter(Boolean),
        notes_considered: [],
        commit_summary: `Recorded document ${options.title}`,
        actions: [
          {
            type: 'record_document',
            title: options.title,
            source_path: options.sourcePath,
            extracted_path: options.extractedPath,
            markdown,
            tags: parseCsv(options.tags),
            aliases: [],
            related_subjects: [],
            project: options.project,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
    });

  kb
    .command('record-transcript')
    .requiredOption('--title <title>')
    .requiredOption('--transcript-path <path>')
    .requiredOption('--from-file <path>')
    .option('--tags <csv>')
    .option('--project <project>')
    .action(async (options) => {
      const runtime = createRuntime();
      const markdown = await fs.readFile(options.fromFile, 'utf8');
      const result = await runtime.knowledgeCli.executePlan({
        summary: `Record transcript ${options.title}`,
        confidence: 'high',
        sources: [options.transcriptPath],
        notes_considered: [],
        commit_summary: `Recorded transcript ${options.title}`,
        actions: [
          {
            type: 'record_transcript',
            title: options.title,
            transcript_path: options.transcriptPath,
            markdown,
            tags: parseCsv(options.tags),
            aliases: [],
            related_subjects: [],
            project: options.project,
          },
        ],
      });
      await runtime.vault.refreshKnowledgeGraph();
      printTouchedNotes(result.touchedNotes.map((note) => note.path));
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
