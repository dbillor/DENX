import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';

import type { AppConfig } from '../config.js';
import type {
  AudioTranscriptionClient,
  TranscriptionRequest,
  TranscriptionResult,
} from './TranscriptionService.js';

interface LocalWhisperReadyMessage {
  type: 'ready';
  model: string;
  backend: string;
}

interface LocalWhisperResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  text?: string;
  language?: string | null;
  language_probability?: number | null;
  duration?: number | null;
  segments?: Array<{ start: number; end: number; text: string }>;
  model?: string;
  backend?: string;
  error?: string;
}

type LocalWhisperWorkerMessage = LocalWhisperReadyMessage | LocalWhisperResultMessage;

export class LocalWhisperTranscriptionService implements AudioTranscriptionClient {
  readonly backend = 'local-whisper';

  private worker: ChildProcessWithoutNullStreams | null = null;
  private workerLines: readline.Interface | null = null;
  private workerReadyPromise: Promise<void> | null = null;
  private workerReadyResolved = false;
  private startupError: Error | null = null;
  private stderrTail = '';
  private nextRequestId = 0;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: TranscriptionResult) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(private readonly config: AppConfig) {}

  async warmUp(): Promise<void> {
    await this.ensureWorker();
  }

  async close(): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    try {
      worker.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`);
    } catch {
      worker.kill();
      return;
    }

    const exitPromise = once(worker, 'exit').catch(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!worker.killed) {
          worker.kill();
        }
        resolve();
      }, 1000);
    });

    await Promise.race([exitPromise.then(() => undefined), timeout]);
  }

  async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResult> {
    await this.ensureWorker();

    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-kb-audio-'));
    const audioPath = path.join(tempDirectory, path.basename(request.fileName));

    try {
      await fs.writeFile(audioPath, request.buffer);
      return await this.sendTranscriptionRequest(audioPath);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Local Whisper transcription failed: ${error.message}`
          : 'Local Whisper transcription failed.',
      );
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private async ensureWorker(): Promise<void> {
    if (this.workerReadyResolved && this.worker) {
      return;
    }

    if (this.workerReadyPromise) {
      return this.workerReadyPromise;
    }

    this.workerReadyPromise = this.startWorker();
    return this.workerReadyPromise;
  }

  private async startWorker(): Promise<void> {
    const pythonPath = path.resolve(this.config.workspaceRoot, this.config.localWhisperPython);
    const scriptPath = path.join(this.config.workspaceRoot, 'scripts', 'transcribe_local_worker.py');

    this.startupError = null;
    this.stderrTail = '';
    this.workerReadyResolved = false;

    const worker = spawn(
      pythonPath,
      [
        scriptPath,
        '--model',
        this.config.localWhisperModel,
        '--compute-type',
        this.config.localWhisperComputeType,
        '--device',
        this.config.localWhisperDevice,
        '--cpu-threads',
        `${this.config.localWhisperCpuThreads}`,
        ...(this.config.localWhisperLanguage
          ? ['--language', this.config.localWhisperLanguage]
          : []),
      ],
      {
        cwd: this.config.workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    this.worker = worker;
    this.workerLines = readline.createInterface({ input: worker.stdout });

    worker.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-4000);
    });

    worker.on('error', (error) => {
      this.startupError = error;
    });

    worker.on('exit', (code, signal) => {
      const error = new Error(
        [
          `Local Whisper worker exited`,
          code !== null ? `with code ${code}` : null,
          signal ? `signal ${signal}` : null,
          this.stderrTail.trim() ? `stderr: ${this.stderrTail.trim()}` : null,
        ]
          .filter(Boolean)
          .join(' '),
      );

      if (!this.workerReadyResolved) {
        this.startupError = error;
      }

      this.rejectPending(error);
      this.workerReadyResolved = false;
      this.workerReadyPromise = null;
      this.worker = null;
      this.workerLines?.close();
      this.workerLines = null;
    });

    this.workerLines.on('line', (line) => {
      this.handleWorkerLine(line);
    });

    const readyTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            this.stderrTail.trim()
              ? `Local Whisper worker did not become ready. ${this.stderrTail.trim()}`
              : 'Local Whisper worker did not become ready.',
          ),
        );
      }, 120000);
    });

    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          const interval = setInterval(() => {
            if (this.workerReadyResolved) {
              clearInterval(interval);
              resolve();
              return;
            }

            if (this.startupError) {
              clearInterval(interval);
              reject(this.startupError);
            }
          }, 25);
        }),
        readyTimeout,
      ]);
    } catch (error) {
      worker.kill();
      this.workerReadyPromise = null;
      throw error;
    }
  }

  private handleWorkerLine(line: string): void {
    let message: LocalWhisperWorkerMessage;

    try {
      message = JSON.parse(line) as LocalWhisperWorkerMessage;
    } catch {
      return;
    }

    if (message.type === 'ready') {
      this.workerReadyResolved = true;
      return;
    }

    if (message.type !== 'result') {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (!message.ok) {
      pending.reject(
        new Error(message.error || 'Local Whisper worker returned an unknown error.'),
      );
      return;
    }

    const text = message.text?.trim();
    if (!text) {
      pending.reject(new Error('Local Whisper worker returned empty text.'));
      return;
    }

    pending.resolve({
      text,
      model: message.model || this.config.localWhisperModel,
    });
  }

  private async sendTranscriptionRequest(audioPath: string): Promise<TranscriptionResult> {
    const worker = this.worker;
    if (!worker?.stdin.writable) {
      throw new Error('Local Whisper worker is not writable.');
    }

    const requestId = `req_${++this.nextRequestId}`;
    const payload = JSON.stringify({
      id: requestId,
      type: 'transcribe',
      audio_path: audioPath,
      language: this.config.localWhisperLanguage || null,
    });

    const resultPromise = new Promise<TranscriptionResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });

    const flushed = worker.stdin.write(`${payload}\n`);
    if (!flushed) {
      await once(worker.stdin, 'drain');
    }

    return resultPromise;
  }

  private rejectPending(error: Error): void {
    for (const [requestId, pending] of this.pending.entries()) {
      this.pending.delete(requestId);
      pending.reject(error);
    }
  }
}
