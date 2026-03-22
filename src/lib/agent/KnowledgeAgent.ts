import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';

import type { AppConfig } from '../config.js';
import type { AskPlan, CapturePlan, OrganizePlan } from './schemas.js';
import { askPlanSchema, capturePlanSchema, organizePlanSchema } from './schemas.js';
import type {
  AskAgentInput,
  CaptureAgentInput,
  KnowledgeAgentClient,
  OrganizeAgentInput,
} from './types.js';

export class KnowledgeAgent implements KnowledgeAgentClient {
  constructor(
    private readonly client: OpenAI,
    private readonly config: AppConfig,
  ) {}

  async shapeCapture(input: CaptureAgentInput): Promise<CapturePlan> {
    const response = await this.client.responses.parse({
      model: this.config.agentModel,
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: 1800,
      instructions: [
        'You are a high-agency knowledge steward for an Obsidian-compatible markdown vault.',
        'Interpret each capture, classify it as note, task, decision, reminder, or project-update, and turn it into durable markdown instead of a raw transcript dump.',
        'Prefer sharp titles, canonical tags, and useful relationships. Only create related subjects that genuinely help the knowledge graph.',
        'Use action_items only for concrete next steps that should become separate task notes.',
        'Return markdown without frontmatter or code fences. Start the markdown with an H1 that matches the title.',
      ].join(' '),
      input: JSON.stringify(
        {
          task: 'shape_capture',
          captured_at: input.capturedAt,
          source_kind: input.sourceKind,
          device: input.device,
          transcript: input.transcript,
          known_context_notes: input.contextNotes,
        },
        null,
        2,
      ),
      text: {
        format: zodTextFormat(capturePlanSchema, 'capture_plan'),
        verbosity: 'medium',
      },
    });

    if (!response.output_parsed) {
      throw new Error('The capture planner returned no structured output.');
    }

    return response.output_parsed;
  }

  async answerAsk(input: AskAgentInput): Promise<AskPlan> {
    const response = await this.client.responses.parse({
      model: this.config.agentModel,
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: 2200,
      instructions: [
        'You are a CLI-based vault manager for a personal knowledge system.',
        'Use the supplied vault context to answer clearly and propose additive vault changes when the user asks for updates, connections, follow-ups, or organization.',
        'Preserve user-authored content. Prefer append_to_note, link_notes, create_note, create_task, and set_status actions instead of rewriting whole notes.',
        'Use citations when you rely on specific notes. Citations should reference note paths or note titles from the provided context.',
      ].join(' '),
      input: JSON.stringify(
        {
          task: 'answer_and_update_vault',
          user_question: input.question,
          vault_context: input.contextNotes,
        },
        null,
        2,
      ),
      text: {
        format: zodTextFormat(askPlanSchema, 'ask_plan'),
        verbosity: 'medium',
      },
    });

    if (!response.output_parsed) {
      throw new Error('The vault assistant returned no structured output.');
    }

    return response.output_parsed;
  }

  async organize(input: OrganizeAgentInput): Promise<OrganizePlan> {
    const response = await this.client.responses.parse({
      model: this.config.agentModel,
      reasoning: { effort: this.config.reasoningEffort },
      max_output_tokens: 1800,
      instructions: [
        'You are organizing a growing markdown knowledge graph.',
        'Inspect the supplied notes and suggest only additive changes that improve links, tags, summaries, or statuses.',
        'Be conservative: prefer a few high-signal actions over many noisy edits.',
      ].join(' '),
      input: JSON.stringify(
        {
          task: 'organize_recent_notes',
          notes: input.notes,
        },
        null,
        2,
      ),
      text: {
        format: zodTextFormat(organizePlanSchema, 'organize_plan'),
        verbosity: 'low',
      },
    });

    if (!response.output_parsed) {
      throw new Error('The organizer returned no structured output.');
    }

    return response.output_parsed;
  }
}
