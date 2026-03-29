import fs from 'node:fs/promises';
import path from 'node:path';

import type { AppConfig } from '../config.js';
import type {
  KnowledgeAction,
  ScribePlan,
} from '../agent/schemas.js';
import type { SearchResult, VaultNoteRecord } from '../types.js';
import { canonicalizeTag, normalizeRef, uniqueStrings } from '../utils.js';
import { VaultStore } from '../vault/VaultStore.js';

export interface PlanExecutionResult {
  touchedNotes: VaultNoteRecord[];
  warnings: string[];
  diffSummary: string;
}

interface SnapshotEntry {
  path: string;
  absolutePath: string;
  originalContent: string | null;
}

export class KnowledgeCliService {
  constructor(
    private readonly vault: VaultStore,
    private readonly config: AppConfig,
  ) {}

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    return this.vault.search(query, limit);
  }

  async read(reference: string): Promise<VaultNoteRecord> {
    return this.vault.load(reference);
  }

  async related(reference: string): Promise<{
    note: VaultNoteRecord;
    outgoing: SearchResult[];
    incoming: SearchResult[];
  }> {
    return this.vault.related(reference);
  }

  diffPlan(plan: ScribePlan): string {
    const lines = [
      `Summary: ${plan.summary}`,
      `Confidence: ${plan.confidence}`,
      `Actions: ${plan.actions.length}`,
    ];

    for (const action of plan.actions) {
      lines.push(`- ${this.describeAction(action)}`);
    }

    return lines.join('\n');
  }

  validatePlan(plan: ScribePlan): string[] {
    const warnings: string[] = [];

    for (const action of plan.actions) {
      switch (action.type) {
        case 'update_note':
        case 'append_to_note':
        case 'set_status':
        case 'link_notes':
        case 'merge_notes':
        case 'archive_note': {
          const targets =
            action.type === 'link_notes'
              ? [action.source, action.target]
              : action.type === 'merge_notes'
                ? [action.target, ...action.sources]
                : [action.target];
          for (const target of targets) {
            if (this.isProtectedSystemPath(target)) {
              warnings.push(
                `${action.type}: refusing to mutate protected provenance path "${target}"`,
              );
            }
          }
          break;
        }
      }
    }

    return warnings;
  }

  async executePlan(plan: ScribePlan): Promise<PlanExecutionResult> {
    const warnings = this.validatePlan(plan);
    const snapshots = new Map<string, SnapshotEntry>();
    const createdPaths = new Set<string>();
    const touched = new Map<string, VaultNoteRecord>();

    try {
      for (const action of plan.actions) {
        if (this.shouldSkipAction(action)) {
          warnings.push(`${action.type}: skipped due to protected provenance target`);
          continue;
        }

        const note = await this.executeAction(action, snapshots, createdPaths);
        if (Array.isArray(note)) {
          for (const item of note) {
            touched.set(item.path, item);
          }
        } else if (note) {
          touched.set(note.path, note);
        }
      }

      return {
        touchedNotes: [...touched.values()],
        warnings,
        diffSummary: this.diffPlan(plan),
      };
    } catch (error) {
      await this.rollbackSnapshots(snapshots, createdPaths);
      throw error;
    }
  }

  private async executeAction(
    action: KnowledgeAction,
    snapshots: Map<string, SnapshotEntry>,
    createdPaths: Set<string>,
  ): Promise<VaultNoteRecord | VaultNoteRecord[] | null> {
    switch (action.type) {
      case 'create_note': {
        const related = await this.ensureRelatedSubjects(action.note.related_subjects);
        const note = await this.vault.createNote({
          title: action.note.title,
          type: action.note.note_type,
          body: this.ensureHeading(action.note.title, action.note.markdown),
          tags: uniqueStrings(action.note.tags.map(canonicalizeTag).concat(action.note.note_type)),
          aliases: action.note.aliases,
          related: related.map((item) => item.slug),
          status: action.note.status,
          project: action.note.project,
          folderHint: action.note.folder_hint,
          slugHint: action.note.slug_hint,
        });
        createdPaths.add(note.path);
        return note;
      }

      case 'update_note': {
        const current = await this.vault.load(action.target);
        await this.snapshotPath(current.path, snapshots);
        const relatedSubjects = await this.ensureRelatedSubjects(action.related_subjects);
        return this.vault.updateNote(action.target, {
          markdown: this.ensureHeading(action.title ?? current.title, action.markdown),
          title: action.title,
          tags: uniqueStrings([...current.frontmatter.tags, ...action.tags]),
          aliases: uniqueStrings([...current.frontmatter.aliases, ...action.aliases]),
          related: uniqueStrings([
            ...current.frontmatter.related,
            ...relatedSubjects.map((item) => item.slug),
          ]),
          status: action.status ?? current.frontmatter.status,
          project: action.project ?? current.frontmatter.project,
        });
      }

      case 'append_to_note': {
        const current = await this.vault.load(action.target);
        await this.snapshotPath(current.path, snapshots);
        return this.vault.appendToSection(action.target, action.section, action.markdown);
      }

      case 'set_status': {
        const current = await this.vault.load(action.target);
        await this.snapshotPath(current.path, snapshots);
        return this.vault.setStatus(action.target, action.status);
      }

      case 'link_notes': {
        const source = await this.vault.load(action.source);
        await this.snapshotPath(source.path, snapshots);
        return this.vault.linkNotes(action.source, action.target);
      }

      case 'merge_notes': {
        const touched: VaultNoteRecord[] = [];
        const target = await this.vault.load(action.target);
        await this.snapshotPath(target.path, snapshots);
        let mergedTarget = target;

        for (const sourceRef of action.sources) {
          const source = await this.vault.load(sourceRef);
          if (normalizeRef(source.path) === normalizeRef(target.path)) {
            continue;
          }
          await this.snapshotPath(source.path, snapshots);
          await this.snapshotPath(mergedTarget.path, snapshots);
          mergedTarget = await this.vault.appendToSection(
            mergedTarget.path,
            'Merged Context',
            [
              `### ${source.title}`,
              '',
              source.content.trim(),
              '',
              `- Merged from [[${source.slug}|${source.title}]]`,
              ...(action.summary ? [`- Merge summary: ${action.summary}`] : []),
            ].join('\n'),
          );
          mergedTarget = await this.vault.linkNotes(mergedTarget.path, source.path);
          touched.push(mergedTarget);

          if (action.archive_sources) {
            const archived = await this.archiveKnowledgeNote(
              source.path,
              action.summary
                ? `Merged into [[${mergedTarget.slug}|${mergedTarget.title}]]. ${action.summary}`
                : `Merged into [[${mergedTarget.slug}|${mergedTarget.title}]].`,
            );
            touched.push(archived);
          }
        }

        return touched;
      }

      case 'archive_note': {
        return this.archiveKnowledgeNote(action.target, action.reason);
      }

      case 'record_memory': {
        const note = await this.vault.load(this.vault.memoryPath(action.target));
        await this.snapshotPath(note.path, snapshots);
        return this.vault.appendToMemory(action.target, action.section, action.markdown);
      }

      case 'record_document': {
        const related = await this.ensureRelatedSubjects(action.related_subjects);
        const note = await this.vault.createNote({
          title: action.title,
          type: 'reference',
          body: this.ensureHeading(action.title, action.markdown),
          tags: uniqueStrings(
            ['document', 'source-material', ...action.tags.map(canonicalizeTag)],
          ),
          aliases: action.aliases,
          related: related.map((item) => item.slug),
          project: action.project,
          folderHint: action.note_path ? undefined : 'notes/documents',
          explicitPath: action.note_path,
          source: {
            kind: 'document',
            capturedAt: new Date().toISOString(),
            documentPath: action.source_path,
            extractionPath: action.extracted_path,
          },
        });
        createdPaths.add(note.path);
        return note;
      }

      case 'record_transcript': {
        const related = await this.ensureRelatedSubjects(action.related_subjects);
        const note = await this.vault.createNote({
          title: action.title,
          type: 'reference',
          body: this.ensureHeading(action.title, action.markdown),
          tags: uniqueStrings(['transcript-note', ...action.tags.map(canonicalizeTag)]),
          aliases: action.aliases,
          related: related.map((item) => item.slug),
          project: action.project,
          folderHint: action.note_path ? undefined : 'notes/transcripts',
          explicitPath: action.note_path,
          source: {
            kind: 'document',
            capturedAt: new Date().toISOString(),
            transcriptPath: action.transcript_path,
          },
        });
        createdPaths.add(note.path);
        return note;
      }
    }
  }

  private async ensureRelatedSubjects(subjects: Array<{ title: string; entity_type: 'note' | 'project' | 'person' | 'system' | 'topic' }>) {
    return Promise.all(
      subjects.map((subject) =>
        this.vault.ensureSubject({
          title: subject.title,
          kind: subject.entity_type,
        }),
      ),
    );
  }

  private ensureHeading(title: string, markdown: string): string {
    const trimmed = markdown.trim();
    if (trimmed.startsWith('# ')) {
      return trimmed;
    }

    return `# ${title}\n\n${trimmed}`;
  }

  private async archiveKnowledgeNote(reference: string, reason?: string): Promise<VaultNoteRecord> {
    if (this.isProtectedSystemPath(reference)) {
      throw new Error(`Refusing to archive protected provenance path "${reference}".`);
    }

    let note = await this.vault.setStatus(reference, 'archived');
    const archiveReason = [
      `- Archived by Denx at ${new Date().toISOString()}.`,
      ...(reason ? [`- Reason: ${reason}`] : []),
    ].join('\n');
    note = await this.vault.appendToSection(note.path, 'Archive History', archiveReason);
    return note;
  }

  private shouldSkipAction(action: KnowledgeAction): boolean {
    switch (action.type) {
      case 'update_note':
      case 'append_to_note':
      case 'set_status':
      case 'archive_note':
        return this.isProtectedSystemPath(action.target);
      case 'link_notes':
        return this.isProtectedSystemPath(action.source) || this.isProtectedSystemPath(action.target);
      case 'merge_notes':
        return [action.target, ...action.sources].some((item) => this.isProtectedSystemPath(item));
      default:
        return false;
    }
  }

  private isProtectedSystemPath(reference: string): boolean {
    const normalized = reference.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.startsWith('_system/');
  }

  private async snapshotPath(pathRef: string, snapshots: Map<string, SnapshotEntry>): Promise<void> {
    const note = await this.vault.load(pathRef);
    if (snapshots.has(note.path)) {
      return;
    }

    const originalContent = await fs.readFile(note.absolutePath, 'utf8');
    snapshots.set(note.path, {
      path: note.path,
      absolutePath: note.absolutePath,
      originalContent,
    });
  }

  private async rollbackSnapshots(
    snapshots: Map<string, SnapshotEntry>,
    createdPaths: Set<string>,
  ): Promise<void> {
    for (const relativePath of createdPaths) {
      const absolutePath = path.join(this.config.vaultRoot, relativePath);
      await fs.rm(absolutePath, { force: true });
    }

    for (const snapshot of snapshots.values()) {
      if (snapshot.originalContent === null) {
        await fs.rm(snapshot.absolutePath, { force: true });
      } else {
        await fs.writeFile(snapshot.absolutePath, snapshot.originalContent, 'utf8');
      }
    }

    await this.vault.rebuildIndex();
  }

  private describeAction(action: KnowledgeAction): string {
    switch (action.type) {
      case 'create_note':
        return `create ${action.note.note_type} "${action.note.title}"`;
      case 'update_note':
        return `update "${action.target}"`;
      case 'append_to_note':
        return `append "${action.target}" -> ${action.section}`;
      case 'set_status':
        return `set status "${action.target}" -> ${action.status}`;
      case 'link_notes':
        return `link "${action.source}" -> "${action.target}"`;
      case 'merge_notes':
        return `merge ${action.sources.length} note(s) into "${action.target}"`;
      case 'archive_note':
        return `archive "${action.target}"`;
      case 'record_memory':
        return `record memory "${action.target}" -> ${action.section}`;
      case 'record_document':
        return `record document "${action.title}"`;
      case 'record_transcript':
        return `record transcript "${action.title}"`;
    }
  }
}
