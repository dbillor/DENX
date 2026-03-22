import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AppConfig } from '../config.js';
import type { SourceKind } from '../types.js';

const execFileAsync = promisify(execFile);

export class NotificationService {
  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.openClawNotifyTarget && this.config.openClawNotifyChannel);
  }

  async notifyCaptureReceived(payload: {
    device?: string;
    capturedAt?: string;
    sourceKind: Extract<SourceKind, 'voice' | 'text'>;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const opening =
      payload.sourceKind === 'voice'
        ? 'Denx received a voice capture.'
        : 'Denx received text for knowledge conversion.';
    const message = [
      opening,
      payload.device ? `Device: ${payload.device}` : undefined,
      payload.capturedAt ? `Captured at: ${payload.capturedAt}` : undefined,
      'Processing now.',
    ]
      .filter(Boolean)
      .join('\n');

    await this.sendMessage(message);
  }

  async notifyCaptureProcessed(payload: {
    transcript: string;
    notePath: string;
    taskPaths: string[];
    sourceKind: Extract<SourceKind, 'voice' | 'text'>;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const opening =
      payload.sourceKind === 'voice'
        ? 'Denx converted the voice capture into knowledge.'
        : 'Denx converted the text into knowledge.';
    const message = [
      opening,
      `Note: ${payload.notePath}`,
      ...(payload.taskPaths.length ? [`Tasks: ${payload.taskPaths.join(', ')}`] : []),
      `Transcript: ${payload.transcript.slice(0, 180)}`,
    ].join('\n');

    await this.sendMessage(message);
  }

  async notifyCaptureFailed(payload: {
    device?: string;
    error: string;
    sourceKind: Extract<SourceKind, 'voice' | 'text'>;
  }): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const opening =
      payload.sourceKind === 'voice'
        ? 'Denx could not process the voice capture.'
        : 'Denx could not process the text input.';
    const message = [
      opening,
      payload.device ? `Device: ${payload.device}` : undefined,
      `Error: ${payload.error}`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.sendMessage(message);
  }

  private async sendMessage(message: string): Promise<void> {
    await execFileAsync(
      'openclaw',
      [
        'message',
        'send',
        '--channel',
        this.config.openClawNotifyChannel!,
        '--target',
        this.config.openClawNotifyTarget!,
        '--message',
        message,
      ],
      {
        cwd: this.config.workspaceRoot,
        maxBuffer: 1024 * 1024,
      },
    );
  }
}
