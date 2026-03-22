import type {
  CaptureRequest,
  CaptureResult,
  IngestionService,
} from './IngestionService.js';
import type { NotificationService } from './NotificationService.js';

export type CaptureJobState = 'queued' | 'processing' | 'completed' | 'failed';

export interface CaptureJobStatus {
  captureId: string;
  state: CaptureJobState;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  device?: string;
  sourceKind: 'voice' | 'text';
  notePath?: string;
  taskPaths?: string[];
  transcriptPath?: string;
  audioPath?: string;
  error?: string;
}

interface CaptureJobRecord {
  request: CaptureRequest;
  status: CaptureJobStatus;
}

export class CaptureQueueService {
  private readonly queue: CaptureJobRecord[] = [];
  private readonly statuses = new Map<string, CaptureJobStatus>();
  private processing = false;

  constructor(
    private readonly ingestion: IngestionService,
    private readonly notification: NotificationService,
  ) {}

  async enqueueCapture(
    request: CaptureRequest,
  ): Promise<Pick<CaptureJobStatus, 'captureId' | 'state' | 'queuedAt'>> {
    const captureId = request.captureId ?? `cap_${Date.now()}`;
    const queuedAt = new Date().toISOString();
    const sourceKind = request.sourceKind ?? (request.audioBuffer ? 'voice' : 'text');
    const normalizedRequest: CaptureRequest = {
      ...request,
      captureId,
      sourceKind,
    };

    const status: CaptureJobStatus = {
      captureId,
      state: 'queued',
      queuedAt,
      device: request.device,
      sourceKind,
    };

    this.queue.push({
      request: normalizedRequest,
      status,
    });
    this.statuses.set(captureId, status);

    try {
      await this.notification.notifyCaptureReceived({
        device: request.device,
        capturedAt: request.capturedAt ?? queuedAt,
        sourceKind,
      });
    } catch (error) {
      console.warn(
        error instanceof Error
          ? `Notification warning: ${error.message}`
          : 'Notification warning: failed to send receipt notice.',
      );
    }

    void this.pump();

    return {
      captureId,
      state: status.state,
      queuedAt: status.queuedAt,
    };
  }

  getCaptureStatus(captureId: string): CaptureJobStatus | undefined {
    return this.statuses.get(captureId);
  }

  private async pump(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        if (!job) {
          continue;
        }

        await this.processJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: CaptureJobRecord): Promise<void> {
    job.status.state = 'processing';
    job.status.startedAt = new Date().toISOString();

    try {
      const result = await this.ingestion.ingestCapture(job.request);
      this.markCompleted(job.status, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected processing error';
      job.status.state = 'failed';
      job.status.completedAt = new Date().toISOString();
      job.status.error = message;

      try {
        await this.notification.notifyCaptureFailed({
          device: job.request.device,
          error: message,
          sourceKind: job.status.sourceKind,
        });
      } catch (notificationError) {
        console.warn(
          notificationError instanceof Error
            ? `Notification warning: ${notificationError.message}`
            : 'Notification warning: failed to send failure notice.',
        );
      }
    }
  }

  private markCompleted(status: CaptureJobStatus, result: CaptureResult): void {
    status.state = 'completed';
    status.completedAt = new Date().toISOString();
    status.notePath = result.primaryNote.path;
    status.taskPaths = result.taskNotes.map((note) => note.path);
    status.transcriptPath = result.transcriptPath;
    status.audioPath = result.audioPath;
  }
}
