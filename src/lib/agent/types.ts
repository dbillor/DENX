import type { ContextNote } from '../vault/VaultStore.js';
import type { ResearchMemo, ScribePlan, SourceRef } from './schemas.js';

export interface ScribeTaskInput {
  mode: 'capture' | 'task' | 'maintenance' | 'document';
  requestText: string;
  capturedAt?: string;
  sourceKind?: 'voice' | 'text' | 'document';
  device?: string;
  sourceRefs: SourceRef[];
  contextPack: ContextNote[];
  researchMemos: ResearchMemo[];
}

export interface KnowledgeAgentClient {
  runScribeTask(input: ScribeTaskInput): Promise<ScribePlan>;
}
