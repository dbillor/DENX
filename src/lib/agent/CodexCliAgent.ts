import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { AppConfig } from '../config.js';
import type { AskPlan, CapturePlan, OrganizePlan } from './schemas.js';
import { askPlanSchema, capturePlanSchema, organizePlanSchema } from './schemas.js';
import type {
  AskAgentInput,
  CaptureAgentInput,
  KnowledgeAgentClient,
  OrganizeAgentInput,
} from './types.js';

const execFileAsync = promisify(execFile);

export class CodexCliAgent implements KnowledgeAgentClient {
  private readonly promptPath: string;

  constructor(private readonly config: AppConfig) {
    this.promptPath = path.join(this.config.workspaceRoot, 'prompts', 'personal-knowledge-codex.md');
  }

  async shapeCapture(input: CaptureAgentInput): Promise<CapturePlan> {
    return this.runStructuredTask(
      capturePlanSchema,
      'shape_capture',
      [
        'Classify the transcript and produce a durable markdown note plan.',
        'Do not write files directly. Only return JSON that matches the schema.',
        'Treat the supplied context notes as the current vault state.',
      ].join(' '),
      {
        task: 'shape_capture',
        captured_at: input.capturedAt,
        source_kind: input.sourceKind,
        device: input.device,
        transcript: input.transcript,
        known_context_notes: input.contextNotes,
      },
    );
  }

  async answerAsk(input: AskAgentInput): Promise<AskPlan> {
    return this.runStructuredTask(
      askPlanSchema,
      'ask_plan',
      [
        'Answer the user from vault context and propose additive vault actions when useful.',
        'Only return JSON that matches the schema.',
        'Prefer append, link, create_note, create_task, and status updates over broad rewrites.',
      ].join(' '),
      {
        task: 'answer_and_update_vault',
        user_question: input.question,
        vault_context: input.contextNotes,
      },
    );
  }

  async organize(input: OrganizeAgentInput): Promise<OrganizePlan> {
    return this.runStructuredTask(
      organizePlanSchema,
      'organize_plan',
      [
        'Review the supplied notes and propose a small set of high-value organizing actions.',
        'Only return JSON that matches the schema.',
        'Be conservative and additive.',
      ].join(' '),
      {
        task: 'organize_recent_notes',
        notes: input.notes,
      },
    );
  }

  private async runStructuredTask<T extends z.ZodTypeAny>(
    schema: T,
    schemaName: string,
    taskInstruction: string,
    payload: unknown,
  ): Promise<z.infer<T>> {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-kb-codex-'));
    const outputPath = path.join(tempDirectory, `${schemaName}.result.json`);

    try {
      const basePrompt = await this.loadBasePrompt();
      const prompt = [
        basePrompt.trim(),
        '',
        'Task instructions:',
        taskInstruction,
        '',
        'Return only JSON, with no markdown fences and no commentary.',
        'Your JSON must conform to this schema:',
        JSON.stringify(z.toJSONSchema(schema, { io: 'output' }), null, 2),
        '',
        'Input payload:',
        JSON.stringify(payload, null, 2),
      ].join('\n');

      await execFileAsync(
        'codex',
        [
          'exec',
          '--enable',
          'multi_agent',
          '--skip-git-repo-check',
          '--ephemeral',
          '-c',
          `model_reasoning_effort="${this.config.reasoningEffort}"`,
          '--sandbox',
          'read-only',
          '--cd',
          this.config.workspaceRoot,
          '--output-last-message',
          outputPath,
          prompt,
        ],
        {
          cwd: this.config.workspaceRoot,
          maxBuffer: 1024 * 1024 * 8,
        },
      );

      const raw = await fs.readFile(outputPath, 'utf8');
      return schema.parse(this.extractJson(raw));
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Local Codex task failed: ${error.message}`
          : 'Local Codex task failed.',
      );
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private async loadBasePrompt(): Promise<string> {
    try {
      return await fs.readFile(this.promptPath, 'utf8');
    } catch {
      return [
        'You are my local personal knowledge operator.',
        'Turn captures into durable markdown notes and actionable vault changes.',
        'Search for relationships, avoid duplicates, and prefer clean Obsidian-style markdown.',
      ].join(' ');
    }
  }

  private extractJson(raw: string): unknown {
    const trimmed = raw.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)?.[1];
      if (fenced) {
        return JSON.parse(fenced.trim());
      }

      const firstBrace = trimmed.indexOf('{');
      const lastBrace = trimmed.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      }

      throw new Error('Codex did not return parseable JSON.');
    }
  }
}
