import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { AppConfig } from '../config.js';
import { scribePlanSchema, type ScribePlan } from './schemas.js';
import type { KnowledgeAgentClient, ScribeTaskInput } from './types.js';

const execFileAsync = promisify(execFile);

export class CodexCliAgent implements KnowledgeAgentClient {
  private readonly promptPath: string;

  constructor(private readonly config: AppConfig) {
    this.promptPath = path.join(this.config.workspaceRoot, 'prompts', 'personal-knowledge-codex.md');
  }

  async runScribeTask(input: ScribeTaskInput): Promise<ScribePlan> {
    return this.runStructuredTask(
      scribePlanSchema,
      'scribe_plan',
      [
        'Act as the Denx scribe.',
        'Create one coherent plan for durable knowledge changes.',
        'Research inputs are advisory only; they cannot mutate the vault.',
        'Return only JSON that matches the schema.',
      ].join(' '),
      {
        task: 'denx_scribe',
        mode: input.mode,
        request_text: input.requestText,
        captured_at: input.capturedAt,
        source_kind: input.sourceKind,
        device: input.device,
        source_refs: input.sourceRefs,
        context_pack: input.contextPack,
        research_memos: input.researchMemos,
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
        'You are the Denx Codex Scribe.',
        'Turn tasks and captures into durable knowledge actions.',
        'You are the only writer; any research inputs are read-only.',
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
