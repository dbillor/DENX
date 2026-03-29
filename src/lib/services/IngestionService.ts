import path from 'node:path';

import type { AppConfig } from '../config.js';
import type { VaultNoteRecord } from '../types.js';
import type { NotificationService } from './NotificationService.js';
import type { AudioTranscriptionClient } from './TranscriptionService.js';
import { VaultStore } from '../vault/VaultStore.js';
import { VaultAssistantService } from './VaultAssistantService.js';

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
  plan: Awaited<ReturnType<VaultAssistantService['runTask']>>['plan'];
  primaryNote?: VaultNoteRecord;
  taskNotes: VaultNoteRecord[];
  relatedNotes: VaultNoteRecord[];
  subjectNotes: VaultNoteRecord[];
  memoryNotes: VaultNoteRecord[];
  transcriptPath: string;
  audioPath?: string;
}

export class IngestionService {
  constructor(
    private readonly vault: VaultStore,
    private readonly assistant: VaultAssistantService,
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

    const execution = await this.assistant.runTask({
      mode: 'capture',
      requestText: transcript,
      capturedAt,
      sourceKind,
      device: request.device,
      sourceRefs: [
        ...(audioPath
          ? [
              {
                kind: 'audio' as const,
                path: audioPath,
                label: request.audioFileName ?? 'capture audio',
                mime_type: request.mimeType,
              },
            ]
          : []),
        {
          kind: 'transcript' as const,
          path: transcriptPath,
          label: `Transcript ${captureId}`,
        },
      ],
    });

    const primaryNote = this.pickPrimaryNote(execution.touchedNotes);
    const taskNotes = execution.touchedNotes.filter((note) => note.type === 'task');
    const relatedNotes = execution.touchedNotes.filter(
      (note) =>
        note.type === 'reference' &&
        !note.path.startsWith('_memory/') &&
        !note.path.startsWith('daily/'),
    );
    const subjectNotes = execution.touchedNotes.filter(
      (note) =>
        note.path.startsWith('projects/') ||
        note.path.startsWith('_memory/people/') ||
        note.path.startsWith('_memory/systems/') ||
        note.path.startsWith('_memory/topics/'),
    );
    const memoryNotes = execution.touchedNotes.filter(
      (note) =>
        note.path.startsWith('_memory/') &&
        !note.path.startsWith('_memory/people/') &&
        !note.path.startsWith('_memory/systems/') &&
        !note.path.startsWith('_memory/topics/'),
    );

    if (primaryNote && execution.plan.actions.length > 0) {
      await this.vault.appendDailyLog({
        capturedAt,
        link: primaryNote.slug,
        title: primaryNote.title,
        summary: execution.plan.summary,
      });
      await this.vault.refreshKnowledgeGraph();
    }

    try {
      await this.notification.notifyCaptureProcessed({
        transcript,
        notePath: primaryNote?.path,
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
      plan: execution.plan,
      primaryNote,
      taskNotes,
      relatedNotes,
      subjectNotes,
      memoryNotes,
      transcriptPath,
      audioPath,
    };
  }

  private pickPrimaryNote(touchedNotes: VaultNoteRecord[]): VaultNoteRecord | undefined {
    return (
      touchedNotes.find((note) => note.type !== 'task' && note.type !== 'daily') ??
      touchedNotes.find((note) => note.type === 'task')
    );
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
