import path from 'node:path';

import type { AppConfig } from '../config.js';
import {
  canonicalizeTag,
  normalizeRef,
  uniqueStrings,
  appendUnderHeading,
  stripLeadingFrontmatter,
} from '../utils.js';
import type { VaultNoteRecord } from '../types.js';
import type { CapturePlan } from '../agent/schemas.js';
import type { KnowledgeAgentClient } from '../agent/types.js';
import type { NotificationService } from './NotificationService.js';
import type { AudioTranscriptionClient } from './TranscriptionService.js';
import { VaultStore } from '../vault/VaultStore.js';

export interface CaptureRequest {
  captureId?: string;
  transcriptText?: string;
  audioBuffer?: Buffer;
  audioFileName?: string;
  mimeType?: string;
  device?: string;
  capturedAt?: string;
  sourceKind?: 'voice' | 'text';
}

export interface CaptureResult {
  captureId: string;
  transcript: string;
  plan: CapturePlan;
  primaryNote: VaultNoteRecord;
  taskNotes: VaultNoteRecord[];
  relatedNotes: VaultNoteRecord[];
  transcriptPath: string;
  audioPath?: string;
}

export class IngestionService {
  constructor(
    private readonly vault: VaultStore,
    private readonly agent: KnowledgeAgentClient | null,
    private readonly transcription: AudioTranscriptionClient | null,
    private readonly notification: NotificationService,
    private readonly config: AppConfig,
  ) {}

  async ingestCapture(request: CaptureRequest): Promise<CaptureResult> {
    await this.vault.ensureStructure();

    const captureId = request.captureId ?? `cap_${Date.now()}`;
    const capturedAt = this.normalizeCapturedAt(request.capturedAt);
    const sourceKind =
      request.sourceKind ?? (request.audioBuffer ? 'voice' : 'text');

    let audioPath: string | undefined;
    if (request.audioBuffer) {
      const extension = this.audioExtension(request.audioFileName, request.mimeType);
      audioPath = await this.vault.saveBinary(
        this.vault.audioPath(captureId, capturedAt, extension),
        request.audioBuffer,
      );
    }

    const transcript =
      request.transcriptText?.trim() ??
      (request.audioBuffer
        ? (await this.requireTranscription().transcribeAudio({
            buffer: request.audioBuffer,
            fileName: request.audioFileName ?? 'capture.m4a',
          })).text
        : '');

    if (!transcript.trim()) {
      throw new Error('No transcript text was available for this capture.');
    }

    const transcriptPath = await this.vault.saveText(
      this.vault.transcriptPath(captureId, capturedAt),
      this.vault.buildTranscriptDocument({
        captureId,
        capturedAt,
        transcript,
        audioPath,
        device: request.device,
        sourceKind,
      }),
    );

    const contextMatches = await this.vault.search(transcript, 6);
    const recentMatches = await this.vault.getRecentNotes(4);
    const contextRefs = uniqueStrings([
      ...contextMatches.map((note) => note.path),
      ...recentMatches.map((note) => note.path),
    ]).slice(0, 8);
    const contextNotes = await this.vault.readNotesForContext(contextRefs, 1500);

    const plan = await this.requireAgent().shapeCapture({
      transcript,
      capturedAt,
      sourceKind,
      device: request.device,
      contextNotes,
    });

    const relatedNotes = await this.materializeRelatedNotes(plan);
    const primaryNote = await this.vault.createNote({
      title: plan.title,
        type: plan.classification,
        body: this.buildPrimaryBody(plan),
      tags: uniqueStrings([
        plan.classification,
        ...(plan.project ? [canonicalizeTag(plan.project)] : []),
        ...plan.canonical_tags.map(canonicalizeTag),
      ]),
      aliases: plan.aliases,
      related: relatedNotes.map((note) => note.slug),
      status: plan.status ?? this.defaultStatus(plan.classification),
      project: plan.project,
      source: {
        kind: sourceKind,
        capturedAt,
        captureId,
        audioPath,
        transcriptPath,
        device: request.device,
        originalText: transcript,
      },
    });

    const taskNotes: VaultNoteRecord[] = [];
    const seenTaskTitles = new Set<string>([normalizeRef(primaryNote.title)]);
    for (const actionItem of plan.action_items) {
      const normalized = normalizeRef(actionItem.title);
      if (!normalized || seenTaskTitles.has(normalized)) {
        continue;
      }

      seenTaskTitles.add(normalized);
      const taskNote = await this.vault.createNote({
        title: actionItem.title,
        type: 'task',
        body: this.buildTaskBody(
          actionItem.title,
          actionItem.details,
          primaryNote,
          actionItem.due_hint,
          actionItem.priority,
          sourceKind,
        ),
        tags: uniqueStrings([
          'task',
          ...plan.canonical_tags.map(canonicalizeTag),
          `priority-${actionItem.priority}`,
        ]),
        related: uniqueStrings([
          primaryNote.slug,
          ...relatedNotes.map((note) => note.slug),
        ]),
        status: 'open',
        project: plan.project,
        source: {
          kind: sourceKind,
          capturedAt,
          captureId,
          audioPath,
          transcriptPath,
          device: request.device,
          originalText: transcript,
        },
      });
      taskNotes.push(taskNote);
    }

    if (plan.should_append_to_daily) {
      await this.vault.appendDailyLog({
        capturedAt,
        link: primaryNote.slug,
        title: primaryNote.title,
        summary: plan.summary,
      });
    }

    await this.vault.refreshKnowledgeGraph();

    try {
      await this.notification.notifyCaptureProcessed({
        transcript,
        notePath: primaryNote.path,
        taskPaths: taskNotes.map((note) => note.path),
        sourceKind,
      });
    } catch (error) {
      console.warn(
        error instanceof Error
          ? `Notification warning: ${error.message}`
          : 'Notification warning: failed to send completion notice.',
      );
    }

    return {
      captureId,
      transcript,
      plan,
      primaryNote,
      taskNotes,
      relatedNotes,
      transcriptPath,
      audioPath,
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

  private requireTranscription(): AudioTranscriptionClient {
    if (!this.transcription) {
      throw new Error('No transcription backend is configured.');
    }

    return this.transcription;
  }

  private normalizeCapturedAt(value?: string): string {
    if (!value?.trim()) {
      return new Date().toISOString();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString();
    }

    return parsed.toISOString();
  }

  private async materializeRelatedNotes(plan: CapturePlan): Promise<VaultNoteRecord[]> {
    const related: VaultNoteRecord[] = [];
    const seen = new Set<string>();
    const seenTitles = new Set<string>();

    if (plan.project?.trim()) {
      seenTitles.add(normalizeRef(plan.project));
      const project = await this.vault.ensureSubject({
        title: plan.project,
        kind: 'project',
      });
      related.push(project);
      seen.add(project.slug);
    }

    for (const subject of plan.related_subjects) {
      const normalizedTitle = normalizeRef(subject.title);
      if (!normalizedTitle || seenTitles.has(normalizedTitle)) {
        continue;
      }

      seenTitles.add(normalizedTitle);
      const note = await this.vault.ensureSubject({
        title: subject.title,
        kind: subject.entity_type,
      });
      if (seen.has(note.slug)) {
        continue;
      }

      seen.add(note.slug);
      related.push(note);
    }

    return related;
  }

  private buildPrimaryBody(plan: CapturePlan): string {
    let body = stripLeadingFrontmatter(plan.note_markdown).trim();
    if (!body.startsWith('# ')) {
      body = `# ${plan.title}\n\n${body}`;
    }

    if (plan.project) {
      body = appendUnderHeading(body, 'Project Context', `- Related project: ${plan.project}`);
    }

    if (plan.follow_ups.length) {
      body = appendUnderHeading(
        body,
        'Suggested Follow-Ups',
        plan.follow_ups.map((item) => `- ${item}`).join('\n'),
      );
    }

    if (plan.classification === 'reminder' && plan.reminder_time_hint) {
      body = appendUnderHeading(body, 'Scheduling', `- Reminder hint: ${plan.reminder_time_hint}`);
    }

    return body;
  }

  private buildTaskBody(
    title: string,
    details: string | undefined,
    primaryNote: VaultNoteRecord,
    dueHint: string | undefined,
    priority: 'low' | 'medium' | 'high',
    sourceKind: 'voice' | 'text',
  ): string {
    const defaultDetails =
      sourceKind === 'voice'
        ? 'Captured automatically from a Denx voice capture.'
        : 'Captured automatically from Denx text input.';
    const lines = [
      `# ${title}`,
      '',
      '## Task',
      `- [ ] ${title}`,
      '',
      '## Details',
      details?.trim() || defaultDetails,
      '',
      '## Context',
      `- Source note: [[${primaryNote.slug}|${primaryNote.title}]]`,
      `- Priority: ${priority}`,
      ...(dueHint ? [`- Due hint: ${dueHint}`] : []),
    ];

    return lines.join('\n');
  }

  private defaultStatus(type: CapturePlan['classification']): string {
    switch (type) {
      case 'task':
        return 'open';
      case 'reminder':
        return 'scheduled';
      case 'decision':
        return 'decided';
      case 'project-update':
        return 'logged';
      default:
        return 'active';
    }
  }

  private audioExtension(fileName: string | undefined, mimeType: string | undefined): string {
    const fromName = fileName ? path.extname(fileName) : '';
    if (fromName) {
      return fromName;
    }

    if (mimeType?.includes('mpeg')) {
      return '.mp3';
    }
    if (mimeType?.includes('wav')) {
      return '.wav';
    }
    if (mimeType?.includes('aac')) {
      return '.aac';
    }

    return '.m4a';
  }
}
