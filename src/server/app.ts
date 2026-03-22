import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';

type CaptureSourceKind = 'voice' | 'text';

export interface CaptureQueueHandler {
  enqueueCapture(input: {
    captureId?: string;
    transcriptText?: string;
    audioBuffer?: Buffer;
    audioFileName?: string;
    mimeType?: string;
    device?: string;
    capturedAt?: string;
    sourceKind?: CaptureSourceKind;
  }): Promise<{
    captureId: string;
    state: 'queued' | 'processing' | 'completed' | 'failed';
    queuedAt: string;
  }>;
  getCaptureStatus(captureId: string): {
    captureId: string;
    state: 'queued' | 'processing' | 'completed' | 'failed';
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
    device?: string;
    sourceKind: CaptureSourceKind;
    notePath?: string;
    taskPaths?: string[];
    transcriptPath?: string;
    audioPath?: string;
    error?: string;
  } | undefined;
}

export interface CaptureNotifier {
  notifyCaptureFailed(payload: {
    device?: string;
    error: string;
    sourceKind: CaptureSourceKind;
  }): Promise<void>;
}

export function createApp(options: {
  captureQueue: CaptureQueueHandler;
  notificationService?: CaptureNotifier;
  captureApiToken?: string;
  maxUploadMb?: number;
}) {
  const app = express();
  const uploadLimit = (options.maxUploadMb ?? 25) * 1024 * 1024;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: uploadLimit,
    },
  });
  const rawAudio = express.raw({
    type: (request) => {
      const contentType = request.headers['content-type'];
      if (typeof contentType !== 'string') {
        return false;
      }

      const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
      return mediaType.startsWith('audio/') || mediaType === 'application/octet-stream';
    },
    limit: uploadLimit,
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/api/captures/:captureId', (request, response) => {
    const status = options.captureQueue.getCaptureStatus(request.params.captureId);
    if (!status) {
      response.status(404).json({ error: 'Capture not found.' });
      return;
    }

    response.json(status);
  });

  const authorizeRequest = (request: Request, response: Response, next: NextFunction) => {
    if (!options.captureApiToken) {
      next();
      return;
    }

    const authorization = request.headers.authorization;
    if (authorization === `Bearer ${options.captureApiToken}`) {
      next();
      return;
    }

    response.status(401).json({ error: 'Unauthorized' });
  };

  const parseCaptureBody = async (
    request: Request,
    response: Response,
    next: NextFunction,
    expectedSourceKind?: CaptureSourceKind,
  ) => {
    try {
      const body =
        request.body && typeof request.body === 'object'
        && !Buffer.isBuffer(request.body)
          ? (request.body as Record<string, unknown>)
          : {};
      const rawAudioBuffer = Buffer.isBuffer(request.body) ? request.body : undefined;
      const headerValue = (name: string): string | undefined => {
        const value = request.headers[name];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }

        return undefined;
      };
      const mimeType =
        request.file?.mimetype ??
        headerValue('content-type')?.split(';')[0]?.trim().toLowerCase();
      const audioBuffer = request.file?.buffer ?? rawAudioBuffer;
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const inferredSourceKind: CaptureSourceKind = audioBuffer ? 'voice' : 'text';

      if (expectedSourceKind === 'voice' && !audioBuffer) {
        response.status(400).json({ error: 'Provide an audio file for the voice capture endpoint.' });
        return;
      }

      if (expectedSourceKind === 'text' && !text) {
        response.status(400).json({ error: 'Provide a text field for the text capture endpoint.' });
        return;
      }

      if (!audioBuffer && !text) {
        console.warn('Capture request missing audio and text.', {
          contentType: request.headers['content-type'],
          bodyKeys: Object.keys(body),
        });
        response.status(400).json({ error: 'Provide an audio file or a text field.' });
        return;
      }

      const sourceKind = expectedSourceKind ?? inferredSourceKind;
      const audioFileName =
        request.file?.originalname ??
        headerValue('x-file-name') ??
        (mimeType?.includes('wav')
          ? 'capture.wav'
          : mimeType?.includes('aiff')
            ? 'capture.aiff'
            : mimeType?.includes('mpeg')
              ? 'capture.mp3'
              : mimeType?.includes('aac')
                ? 'capture.aac'
                : 'capture.m4a');

      const result = await options.captureQueue.enqueueCapture({
        transcriptText: text || undefined,
        audioBuffer,
        audioFileName,
        mimeType,
        device:
          typeof body.device === 'string' && body.device.trim()
            ? body.device
            : headerValue('x-device')
              ? headerValue('x-device')
              : sourceKind === 'voice'
                ? 'iPhone Shortcut'
                : 'Denx Text Input',
        capturedAt:
          typeof body.capturedAt === 'string' && body.capturedAt.trim()
            ? body.capturedAt
            : headerValue('x-captured-at')
              ? headerValue('x-captured-at')
              : undefined,
        sourceKind,
      });

      response.status(202).json({
        captureId: result.captureId,
        status: result.state,
        sourceKind,
        queuedAt: result.queuedAt,
        statusUrl: `/api/captures/${result.captureId}`,
      });
    } catch (error) {
      next(error);
    }
  };

  const captureMiddleware = [
    authorizeRequest,
    rawAudio,
    (request: Request, response: Response, next: NextFunction) => {
      const contentType = request.headers['content-type'];
      if (
        typeof contentType === 'string' &&
        contentType.toLowerCase().includes('multipart/form-data')
      ) {
        upload.single('audio')(request, response, next);
        return;
      }

      next();
    },
  ];

  app.post('/api/captures', ...captureMiddleware, (request, response, next) =>
    void parseCaptureBody(request, response, next),
  );

  app.post('/api/captures/voice', ...captureMiddleware, (request, response, next) =>
    void parseCaptureBody(request, response, next, 'voice'),
  );

  app.post('/api/captures/text', ...captureMiddleware, (request, response, next) =>
    void parseCaptureBody(request, response, next, 'text'),
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    console.error(error);
    response.status(500).json({ error: message });
  });

  return app;
}
