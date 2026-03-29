export const captureClassifications = [
  'note',
  'task',
  'decision',
  'reminder',
  'project-update',
] as const;

export type CaptureClassification = (typeof captureClassifications)[number];
export type WritableNoteType = CaptureClassification | 'reference';

export const entityKinds = ['note', 'project', 'person', 'system', 'topic'] as const;

export type EntityKind = (typeof entityKinds)[number];

export type SourceKind = 'voice' | 'text' | 'ask' | 'organize' | 'document' | 'task' | 'maintenance';

export type VaultNoteType = CaptureClassification | 'daily' | 'reference';

export interface CaptureSourceMetadata {
  kind: SourceKind;
  capturedAt: string;
  captureId?: string;
  audioPath?: string;
  transcriptPath?: string;
  documentPath?: string;
  extractionPath?: string;
  device?: string;
  originalText?: string;
  query?: string;
}

export interface VaultNoteFrontmatter {
  id: string;
  title: string;
  type: VaultNoteType;
  status?: string;
  created: string;
  updated: string;
  tags: string[];
  aliases: string[];
  related: string[];
  project?: string;
  source_kind?: SourceKind;
  source_capture_id?: string;
  source_audio?: string;
  source_transcript?: string;
  source_document?: string;
  source_extraction?: string;
  source_query?: string;
  generated_by: 'voice-kb' | 'denx';
}

export interface VaultNoteRecord {
  id: string;
  title: string;
  type: VaultNoteType;
  path: string;
  absolutePath: string;
  slug: string;
  content: string;
  frontmatter: VaultNoteFrontmatter;
  links: string[];
  excerpt: string;
}

export interface IndexNoteSummary {
  id: string;
  title: string;
  type: VaultNoteType;
  status?: string;
  path: string;
  slug: string;
  tags: string[];
  aliases: string[];
  outgoingLinks: string[];
  incomingLinks: string[];
  excerpt: string;
  created: string;
  updated: string;
}

export interface VaultGraphIndex {
  generatedAt: string;
  notes: IndexNoteSummary[];
}

export interface SearchResult extends IndexNoteSummary {
  score: number;
  absolutePath: string;
}

export interface CreateNoteInput {
  title: string;
  type: WritableNoteType;
  body: string;
  tags?: string[];
  aliases?: string[];
  related?: string[];
  status?: string;
  project?: string;
  source?: CaptureSourceMetadata;
  explicitPath?: string;
  folderHint?: string;
  slugHint?: string;
}
