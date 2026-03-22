import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

describe('createApp', () => {
  it('enforces token auth and accepts text captures into the background queue', async () => {
    const captureQueue = {
      enqueueCapture: vi.fn().mockResolvedValue({
        captureId: 'cap_123',
        state: 'queued',
        queuedAt: '2026-03-21T20:45:00.000Z',
      }),
      getCaptureStatus: vi.fn().mockReturnValue({
        captureId: 'cap_123',
        state: 'completed',
        queuedAt: '2026-03-21T20:45:00.000Z',
        completedAt: '2026-03-21T20:45:05.000Z',
        sourceKind: 'text',
        notePath: 'notes/hello-world.md',
      }),
    };

    const app = createApp({
      captureQueue,
      captureApiToken: 'secret',
      maxUploadMb: 5,
    });

    await request(app).get('/healthz').expect(200);
    await request(app).post('/api/captures/text').field('text', 'hello').expect(401);

    const response = await request(app)
      .post('/api/captures/text')
      .set('Authorization', 'Bearer secret')
      .field('text', 'hello')
      .expect(202);

    expect(response.body.captureId).toBe('cap_123');
    expect(response.body.status).toBe('queued');
    expect(response.body.sourceKind).toBe('text');
    expect(response.body.statusUrl).toBe('/api/captures/cap_123');
    expect(captureQueue.enqueueCapture).toHaveBeenCalledOnce();

    const statusResponse = await request(app)
      .get('/api/captures/cap_123')
      .expect(200);

    expect(statusResponse.body.notePath).toBe('notes/hello-world.md');
    expect(captureQueue.getCaptureStatus).toHaveBeenCalledWith('cap_123');
  });

  it('rejects text-only submissions to the voice endpoint', async () => {
    const app = createApp({
      captureQueue: {
        enqueueCapture: vi.fn(),
        getCaptureStatus: vi.fn(),
      },
      captureApiToken: 'secret',
      maxUploadMb: 5,
    });

    const response = await request(app)
      .post('/api/captures/voice')
      .set('Authorization', 'Bearer secret')
      .field('text', 'hello')
      .expect(400);

    expect(response.body.error).toBe('Provide an audio file for the voice capture endpoint.');
  });
});
