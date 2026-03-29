import fs from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

import type { AppConfig } from '../config.js';
import { scribePlanSchema, type ScribePlan } from './schemas.js';
import type { KnowledgeAgentClient, ScribeTaskInput } from './types.js';

export class KnowledgeAgent implements KnowledgeAgentClient {
  private readonly promptPath: string;

  constructor(
    private readonly client: OpenAI,
    private readonly config: AppConfig,
  ) {
    this.promptPath = path.join(this.config.workspaceRoot, 'prompts', 'personal-knowledge-codex.md');
  }

  async runScribeTask(input: ScribeTaskInput): Promise<ScribePlan> {
    const response = await this.client.responses.parse({
      model: this.config.agentModel,
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: 2600,
      instructions: await this.loadBasePrompt(),
      input: JSON.stringify(
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
        null,
        2,
      ),
      text: {
        format: zodTextFormat(scribePlanSchema, 'scribe_plan'),
        verbosity: 'medium',
      },
    });

    if (!response.output_parsed) {
      throw new Error('The Denx scribe returned no structured output.');
    }

    return response.output_parsed;
  }

  private async loadBasePrompt(): Promise<string> {
    try {
      return await fs.readFile(this.promptPath, 'utf8');
    } catch {
      return [
        'You are the Denx Codex Scribe.',
        'Maintain a high-quality personal knowledge base.',
        'You are the only writer; any research inputs are read-only.',
        'Return only structured output that matches the provided schema.',
      ].join(' ');
    }
  }
}
