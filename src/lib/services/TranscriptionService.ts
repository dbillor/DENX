import OpenAI, { toFile } from 'openai';

import type { AppConfig } from '../config.js';

export interface TranscriptionRequest {
  buffer: Buffer;
  fileName: string;
}

export interface TranscriptionResult {
  text: string;
  model: string;
}

export interface AudioTranscriptionClient {
  backend: string;
  warmUp?(): Promise<void>;
  close?(): Promise<void>;
  transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export class TranscriptionService implements AudioTranscriptionClient {
  readonly backend = 'openai';

  constructor(
    private readonly client: OpenAI,
    private readonly config: AppConfig,
  ) {}

  async transcribeAudio(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const file = await toFile(request.buffer, request.fileName);
    const transcription = await this.client.audio.transcriptions.create({
      file,
      model: this.config.transcriptionModel,
      response_format: 'json',
      prompt:
        'This is a personal voice memo. Preserve names, dates, task wording, and product terms accurately.',
    });

    return {
      text: transcription.text.trim(),
      model: this.config.transcriptionModel,
    };
  }
}
