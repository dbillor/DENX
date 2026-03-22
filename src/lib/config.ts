import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export interface AppConfig {
  workspaceRoot: string;
  vaultRoot: string;
  port: number;
  captureApiToken?: string;
  openAIApiKey?: string;
  agentModel: string;
  transcriptionBackend: 'local-whisper' | 'openai';
  transcriptionModel: string;
  localWhisperModel: string;
  localWhisperComputeType: string;
  localWhisperDevice: string;
  localWhisperPython: string;
  localWhisperLanguage?: string;
  localWhisperCpuThreads: number;
  reasoningEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  maxUploadMb: number;
  timeZone: string;
  openClawNotifyChannel?: string;
  openClawNotifyTarget?: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReasoningEffort(
  value: string | undefined,
): AppConfig['reasoningEffort'] {
  const allowed: AppConfig['reasoningEffort'][] = [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ];

  return allowed.includes((value as AppConfig['reasoningEffort']) ?? 'xhigh')
    ? (value as AppConfig['reasoningEffort'])
    : 'xhigh';
}

function parseTranscriptionBackend(
  value: string | undefined,
): AppConfig['transcriptionBackend'] {
  return value === 'openai' ? 'openai' : 'local-whisper';
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const workspaceRoot = overrides.workspaceRoot ?? process.cwd();
  const vaultRoot = overrides.vaultRoot
    ? path.resolve(workspaceRoot, overrides.vaultRoot)
    : path.resolve(workspaceRoot, process.env.VAULT_ROOT ?? 'vault');

  return {
    workspaceRoot,
    vaultRoot,
    port: overrides.port ?? parseNumber(process.env.PORT, 8787),
    captureApiToken: overrides.captureApiToken ?? process.env.CAPTURE_API_TOKEN,
    openAIApiKey: overrides.openAIApiKey ?? process.env.OPENAI_API_KEY,
    agentModel: overrides.agentModel ?? process.env.OPENAI_AGENT_MODEL ?? 'gpt-5.2',
    transcriptionBackend:
      overrides.transcriptionBackend ??
      parseTranscriptionBackend(process.env.TRANSCRIPTION_BACKEND),
    transcriptionModel:
      overrides.transcriptionModel ??
      process.env.OPENAI_TRANSCRIPTION_MODEL ??
      'gpt-4o-mini-transcribe',
    localWhisperModel:
      overrides.localWhisperModel ?? process.env.LOCAL_WHISPER_MODEL ?? 'large-v3',
    localWhisperComputeType:
      overrides.localWhisperComputeType ?? process.env.LOCAL_WHISPER_COMPUTE_TYPE ?? 'int8',
    localWhisperDevice:
      overrides.localWhisperDevice ?? process.env.LOCAL_WHISPER_DEVICE ?? 'cpu',
    localWhisperPython:
      overrides.localWhisperPython ??
      process.env.LOCAL_WHISPER_PYTHON ??
      '.venv/bin/python',
    localWhisperLanguage:
      overrides.localWhisperLanguage ?? process.env.LOCAL_WHISPER_LANGUAGE,
    localWhisperCpuThreads:
      overrides.localWhisperCpuThreads ??
      parseNumber(process.env.LOCAL_WHISPER_CPU_THREADS, 16),
    reasoningEffort:
      overrides.reasoningEffort ?? parseReasoningEffort(process.env.OPENAI_REASONING_EFFORT),
    maxUploadMb: overrides.maxUploadMb ?? parseNumber(process.env.CAPTURE_MAX_UPLOAD_MB, 25),
    timeZone: overrides.timeZone ?? process.env.TIMEZONE ?? 'America/Los_Angeles',
    openClawNotifyChannel:
      overrides.openClawNotifyChannel ?? process.env.OPENCLAW_NOTIFY_CHANNEL,
    openClawNotifyTarget:
      overrides.openClawNotifyTarget ?? process.env.OPENCLAW_NOTIFY_TARGET,
  };
}

export function assertOpenAIKey(config: AppConfig, feature: string): void {
  if (!config.openAIApiKey) {
    throw new Error(`OPENAI_API_KEY is required for ${feature}.`);
  }
}
