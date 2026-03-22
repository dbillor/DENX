import type { ContextNote } from '../vault/VaultStore.js';
import type { AskPlan, CapturePlan, OrganizePlan } from './schemas.js';

export interface CaptureAgentInput {
  transcript: string;
  capturedAt: string;
  sourceKind: 'voice' | 'text';
  device?: string;
  contextNotes: ContextNote[];
}

export interface AskAgentInput {
  question: string;
  contextNotes: ContextNote[];
}

export interface OrganizeAgentInput {
  notes: ContextNote[];
}

export interface KnowledgeAgentClient {
  shapeCapture(input: CaptureAgentInput): Promise<CapturePlan>;
  answerAsk(input: AskAgentInput): Promise<AskPlan>;
  organize(input: OrganizeAgentInput): Promise<OrganizePlan>;
}

