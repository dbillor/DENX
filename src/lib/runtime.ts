import OpenAI from 'openai';

import { loadConfig, type AppConfig } from './config.js';
import { CodexCliAgent } from './agent/CodexCliAgent.js';
import { KnowledgeAgent } from './agent/KnowledgeAgent.js';
import type { KnowledgeAgentClient } from './agent/types.js';
import { CaptureQueueService } from './services/CaptureQueueService.js';
import { IngestionService } from './services/IngestionService.js';
import { KnowledgeCliService } from './services/KnowledgeCliService.js';
import { LocalWhisperTranscriptionService } from './services/LocalWhisperTranscriptionService.js';
import { NotificationService } from './services/NotificationService.js';
import { TranscriptionService, type AudioTranscriptionClient } from './services/TranscriptionService.js';
import { VaultAssistantService } from './services/VaultAssistantService.js';
import { VaultStore } from './vault/VaultStore.js';
import { DocumentIngestionService } from './services/DocumentIngestionService.js';

export interface AppRuntime {
  config: AppConfig;
  vault: VaultStore;
  agent: KnowledgeAgentClient | null;
  transcription: AudioTranscriptionClient | null;
  notification: NotificationService;
  knowledgeCli: KnowledgeCliService;
  ingestion: IngestionService;
  documentIngestion: DocumentIngestionService;
  captureQueue: CaptureQueueService;
  assistant: VaultAssistantService;
  agentBackend: 'openai' | 'codex-cli' | 'none';
  transcriptionBackend: 'openai' | 'local-whisper' | 'none';
}

export function createRuntime(overrides: Partial<AppConfig> = {}): AppRuntime {
  const config = loadConfig(overrides);
  const vault = new VaultStore(config.vaultRoot, config.timeZone);
  const client = config.openAIApiKey ? new OpenAI({ apiKey: config.openAIApiKey }) : null;
  const agent = client
    ? new KnowledgeAgent(client, config)
    : new CodexCliAgent(config);
  const transcription =
    config.transcriptionBackend === 'openai'
      ? client
        ? new TranscriptionService(client, config)
        : null
      : new LocalWhisperTranscriptionService(config);
  const notification = new NotificationService(config);
  const knowledgeCli = new KnowledgeCliService(vault, config);
  const assistant = new VaultAssistantService(vault, agent, knowledgeCli, config);
  const ingestion = new IngestionService(vault, assistant, transcription, notification, config);
  const documentIngestion = new DocumentIngestionService(vault, assistant, config);
  const captureQueue = new CaptureQueueService(ingestion, notification);

  return {
    config,
    vault,
    agent,
    transcription,
    notification,
    knowledgeCli,
    ingestion,
    documentIngestion,
    captureQueue,
    assistant,
    agentBackend: client ? 'openai' : 'codex-cli',
    transcriptionBackend:
      transcription?.backend === 'openai' ? 'openai' : transcription ? 'local-whisper' : 'none',
  };
}
