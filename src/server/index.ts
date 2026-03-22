import { createRuntime } from '../lib/runtime.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const runtime = createRuntime();
  await runtime.vault.ensureStructure();
  await runtime.vault.rebuildIndex();
  await runtime.transcription?.warmUp?.();

  const app = createApp({
    captureQueue: runtime.captureQueue,
    captureApiToken: runtime.config.captureApiToken,
    maxUploadMb: runtime.config.maxUploadMb,
  });

  app.listen(runtime.config.port, () => {
    console.log(`Denx capture server listening on http://localhost:${runtime.config.port}`);
    console.log(`Vault root: ${runtime.config.vaultRoot}`);
    if (runtime.transcriptionBackend === 'local-whisper') {
      console.log(`Local Whisper worker warmed with model ${runtime.config.localWhisperModel}`);
    }
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
