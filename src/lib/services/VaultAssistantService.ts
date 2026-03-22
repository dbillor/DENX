import { appendUnderHeading, canonicalizeTag, uniqueStrings } from '../utils.js';
import type { AppConfig } from '../config.js';
import type { AskAction, AskPlan, OrganizePlan } from '../agent/schemas.js';
import type { KnowledgeAgentClient } from '../agent/types.js';
import type { VaultNoteRecord } from '../types.js';
import { VaultStore } from '../vault/VaultStore.js';

export interface AskExecutionResult {
  answer: string;
  citations: string[];
  touchedNotes: VaultNoteRecord[];
  warnings: string[];
  plan: AskPlan;
}

export interface OrganizeExecutionResult {
  summary: string;
  touchedNotes: VaultNoteRecord[];
  warnings: string[];
  plan: OrganizePlan;
}

export class VaultAssistantService {
  constructor(
    private readonly vault: VaultStore,
    private readonly agent: KnowledgeAgentClient | null,
    private readonly config: AppConfig,
  ) {}

  async ask(question: string, apply = true): Promise<AskExecutionResult> {
    const primaryMatches = await this.vault.search(question, 8);
    const recentMatches = await this.vault.getRecentNotes(4);
    const contextRefs = uniqueStrings([
      ...primaryMatches.map((note) => note.path),
      ...recentMatches.map((note) => note.path),
    ]).slice(0, 10);
    const contextNotes = await this.vault.readNotesForContext(contextRefs, 1800);
    const plan = await this.requireAgent().answerAsk({
      question,
      contextNotes,
    });

    const execution = apply
      ? await this.applyActions(plan.actions, {
          kind: 'ask',
          capturedAt: new Date().toISOString(),
          query: question,
        })
      : { touchedNotes: [] as VaultNoteRecord[], warnings: [] as string[] };

    if (apply && execution.touchedNotes.length > 0) {
      await this.vault.refreshKnowledgeGraph();
    }

    return {
      answer: plan.answer,
      citations: plan.citations,
      touchedNotes: execution.touchedNotes,
      warnings: execution.warnings,
      plan,
    };
  }

  async organize(limit = 12, apply = true): Promise<OrganizeExecutionResult> {
    const recentNotes = await this.vault.getRecentNotes(limit);
    const contextNotes = await this.vault.readNotesForContext(
      recentNotes.map((note) => note.path),
      1600,
    );
    const plan = await this.requireAgent().organize({
      notes: contextNotes,
    });

    const execution = apply
      ? await this.applyActions(plan.actions, {
          kind: 'organize',
          capturedAt: new Date().toISOString(),
          query: `organize recent ${limit} notes`,
        })
      : { touchedNotes: [] as VaultNoteRecord[], warnings: [] as string[] };

    if (apply && execution.touchedNotes.length > 0) {
      await this.vault.refreshKnowledgeGraph();
    }

    return {
      summary: plan.summary,
      touchedNotes: execution.touchedNotes,
      warnings: execution.warnings,
      plan,
    };
  }

  private requireAgent(): KnowledgeAgentClient {
    if (!this.agent) {
      throw new Error(
        'No knowledge agent is available. Sign into Codex CLI or set OPENAI_API_KEY.',
      );
    }

    return this.agent;
  }

  private async applyActions(
    actions: AskAction[],
    source: { kind: 'ask' | 'organize'; capturedAt: string; query: string },
  ): Promise<{ touchedNotes: VaultNoteRecord[]; warnings: string[] }> {
    const touchedNotes = new Map<string, VaultNoteRecord>();
    const warnings: string[] = [];

    for (const action of actions) {
      try {
        switch (action.type) {
          case 'create_note': {
            const relatedNotes = await Promise.all(
              action.note.related_subjects.map((subject) =>
                this.vault.ensureSubject({
                  title: subject.title,
                  kind: subject.entity_type,
                }),
              ),
            );
            const note = await this.vault.createNote({
              title: action.note.title,
              type: action.note.classification,
              body: this.ensureHeading(action.note.title, action.note.markdown),
              tags: uniqueStrings(
                action.note.tags.map(canonicalizeTag).concat(action.note.classification),
              ),
              aliases: action.note.aliases,
              related: relatedNotes.map((item) => item.slug),
              status: action.note.status,
              project: action.note.project,
              source: {
                kind: source.kind,
                capturedAt: source.capturedAt,
                query: source.query,
              },
            });
            touchedNotes.set(note.path, note);
            break;
          }

          case 'create_task': {
            const relatedNotes = await Promise.all(
              action.related_subjects.map((subject) =>
                this.vault.ensureSubject({
                  title: subject.title,
                  kind: subject.entity_type,
                }),
              ),
            );
            const task = await this.vault.createNote({
              title: action.title,
              type: 'task',
              body: this.buildTaskBody(action.title, action.markdown, action.due_hint, action.priority),
              tags: uniqueStrings(
                action.tags.map(canonicalizeTag).concat(['task', `priority-${action.priority}`]),
              ),
              related: relatedNotes.map((item) => item.slug),
              status: 'open',
              source: {
                kind: source.kind,
                capturedAt: source.capturedAt,
                query: source.query,
              },
            });
            touchedNotes.set(task.path, task);
            break;
          }

          case 'append_to_note': {
            const note = await this.vault.appendToSection(action.target, action.section, action.markdown);
            touchedNotes.set(note.path, note);
            break;
          }

          case 'set_status': {
            const note = await this.vault.setStatus(action.target, action.status);
            touchedNotes.set(note.path, note);
            break;
          }

          case 'link_notes': {
            const note = await this.vault.linkNotes(action.source, action.target);
            touchedNotes.set(note.path, note);
            break;
          }
        }
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `${action.type}: ${error.message}`
            : `${action.type}: unknown error`,
        );
      }
    }

    return {
      touchedNotes: [...touchedNotes.values()],
      warnings,
    };
  }

  private ensureHeading(title: string, markdown: string): string {
    const trimmed = markdown.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed;
    }

    return `# ${title}\n\n${trimmed}`;
  }

  private buildTaskBody(
    title: string,
    markdown: string,
    dueHint: string | undefined,
    priority: 'low' | 'medium' | 'high',
  ): string {
    let body = markdown.trim();
    if (!body.startsWith('# ')) {
      body = `# ${title}\n\n## Task\n- [ ] ${title}\n\n## Details\n${body}`;
    }

    body = appendUnderHeading(body, 'Context', `- Created by CLI assistant\n- Priority: ${priority}`);
    if (dueHint) {
      body = appendUnderHeading(body, 'Context', `- Due hint: ${dueHint}`);
    }

    return body;
  }
}
