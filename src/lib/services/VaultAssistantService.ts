import type { AppConfig } from '../config.js';
import type { KnowledgeAgentClient, ScribeTaskInput } from '../agent/types.js';
import type { SourceRef, ResearchMemo, ScribePlan } from '../agent/schemas.js';
import type { VaultNoteRecord } from '../types.js';
import { uniqueStrings } from '../utils.js';
import { VaultStore } from '../vault/VaultStore.js';
import { KnowledgeCliService } from './KnowledgeCliService.js';

export interface ScribeExecutionResult {
  summary: string;
  touchedNotes: VaultNoteRecord[];
  warnings: string[];
  plan: ScribePlan;
  diffSummary: string;
}

export interface AskExecutionResult extends ScribeExecutionResult {
  answer: string;
  citations: string[];
}

export interface OrganizeExecutionResult extends ScribeExecutionResult {}

export class VaultAssistantService {
  constructor(
    private readonly vault: VaultStore,
    private readonly agent: KnowledgeAgentClient | null,
    private readonly cli: KnowledgeCliService,
    private readonly config: AppConfig,
  ) {}

  async runTask(
    input: Omit<ScribeTaskInput, 'contextPack' | 'researchMemos'> & {
      extraContextRefs?: string[];
      researchMemos?: ResearchMemo[];
    },
    apply = true,
  ): Promise<ScribeExecutionResult> {
    const contextPack = await this.buildContextPack(input.requestText, input.extraContextRefs ?? []);
    const plan = await this.requireAgent().runScribeTask({
      ...input,
      contextPack,
      researchMemos: input.researchMemos ?? [],
    });
    const diffSummary = this.cli.diffPlan(plan);

    const execution = apply
      ? await this.cli.executePlan(plan)
      : {
          touchedNotes: [] as VaultNoteRecord[],
          warnings: this.cli.validatePlan(plan),
          diffSummary,
        };

    if (apply && execution.touchedNotes.length > 0) {
      await this.vault.refreshKnowledgeGraph();
    }

    return {
      summary: plan.summary,
      touchedNotes: execution.touchedNotes,
      warnings: execution.warnings,
      plan,
      diffSummary,
    };
  }

  async ask(question: string, apply = true): Promise<AskExecutionResult> {
    const result = await this.runTask(
      {
        mode: 'task',
        requestText: question,
        sourceKind: 'text',
        sourceRefs: [
          {
            kind: 'query',
            path: question,
            label: 'CLI question',
          },
        ],
      },
      apply,
    );

    return {
      ...result,
      answer: result.summary,
      citations: result.plan.notes_considered,
    };
  }

  async organize(limit = 12, apply = true): Promise<OrganizeExecutionResult> {
    const recentNotes = await this.vault.getRecentNotes(limit);
    const result = await this.runTask(
      {
        mode: 'maintenance',
        requestText: `Review the recent vault activity and improve the graph quality for the ${limit} most recent notes.`,
        sourceKind: 'text',
        sourceRefs: [
          {
            kind: 'query',
            path: `maintenance:recent:${limit}`,
            label: 'Recent-note maintenance',
          },
        ],
        extraContextRefs: recentNotes.map((note) => note.path),
      },
      apply,
    );

    return result;
  }

  private requireAgent(): KnowledgeAgentClient {
    if (!this.agent) {
      throw new Error(
        'No knowledge agent is available. Sign into Codex CLI or set OPENAI_API_KEY.',
      );
    }

    return this.agent;
  }

  private async buildContextPack(requestText: string, extraRefs: string[]): Promise<Awaited<ReturnType<VaultStore['readNotesForContext']>>> {
    const primaryMatches = await this.vault.search(requestText, 8);
    const recentMatches = await this.vault.getRecentNotes(4);
    const contextRefs = uniqueStrings([
      ...extraRefs,
      ...primaryMatches.map((note) => note.path),
      ...recentMatches.map((note) => note.path),
    ]).slice(0, 12);

    return this.vault.readNotesForContext(contextRefs, 1800);
  }
}
