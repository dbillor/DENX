import { z } from 'zod';

export const scribeModeSchema = z.enum([
  'capture',
  'task',
  'maintenance',
  'document',
]);

export const confidenceSchema = z.enum(['low', 'medium', 'high']);

export const writableNoteTypeSchema = z.enum([
  'note',
  'task',
  'decision',
  'reminder',
  'project-update',
  'reference',
]);

export const entityTypeSchema = z.enum(['note', 'project', 'person', 'system', 'topic']);

export const relatedSubjectSchema = z.object({
  title: z.string().min(1).max(120),
  relation: z.string().min(1).max(160),
  entity_type: entityTypeSchema.default('note'),
  create_if_missing: z.boolean().default(true),
});

export const memoryTargetSchema = z.enum([
  'identity',
  'preferences',
  'principles',
  'open-questions',
]);

export const sourceRefSchema = z.object({
  kind: z.enum([
    'audio',
    'transcript',
    'document-source',
    'document-extraction',
    'query',
  ]),
  path: z.string().min(1).max(300),
  label: z.string().max(160).optional(),
  mime_type: z.string().max(120).optional(),
});

export const researchMemoSchema = z.object({
  kind: z.enum(['retrieval', 'linking', 'dedupe', 'task-shaping']),
  summary: z.string().min(1).max(1200),
  refs: z.array(z.string().min(1).max(200)).max(16).default([]),
});

const noteDraftSchema = z.object({
  note_type: writableNoteTypeSchema,
  title: z.string().min(3).max(160),
  markdown: z.string().min(1).max(16000),
  tags: z.array(z.string().min(1).max(48)).max(16).default([]),
  aliases: z.array(z.string().min(1).max(160)).max(8).default([]),
  related_subjects: z.array(relatedSubjectSchema).max(12).default([]),
  status: z.string().max(40).optional(),
  project: z.string().max(120).optional(),
  folder_hint: z.string().max(200).optional(),
  slug_hint: z.string().max(160).optional(),
});

export const knowledgeActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_note'),
    note: noteDraftSchema,
  }),
  z.object({
    type: z.literal('update_note'),
    target: z.string().min(1).max(240),
    markdown: z.string().min(1).max(20000),
    title: z.string().min(1).max(160).optional(),
    tags: z.array(z.string().min(1).max(48)).max(16).default([]),
    aliases: z.array(z.string().min(1).max(160)).max(8).default([]),
    related_subjects: z.array(relatedSubjectSchema).max(12).default([]),
    status: z.string().max(40).optional(),
    project: z.string().max(120).optional(),
  }),
  z.object({
    type: z.literal('append_to_note'),
    target: z.string().min(1).max(240),
    section: z.string().min(1).max(80),
    markdown: z.string().min(1).max(8000),
  }),
  z.object({
    type: z.literal('set_status'),
    target: z.string().min(1).max(240),
    status: z.string().min(1).max(40),
  }),
  z.object({
    type: z.literal('link_notes'),
    source: z.string().min(1).max(240),
    target: z.string().min(1).max(240),
    relation: z.string().min(1).max(160).optional(),
  }),
  z.object({
    type: z.literal('merge_notes'),
    target: z.string().min(1).max(240),
    sources: z.array(z.string().min(1).max(240)).min(1).max(8),
    summary: z.string().max(1000).optional(),
    archive_sources: z.boolean().default(true),
  }),
  z.object({
    type: z.literal('archive_note'),
    target: z.string().min(1).max(240),
    reason: z.string().max(600).optional(),
  }),
  z.object({
    type: z.literal('record_memory'),
    target: memoryTargetSchema,
    section: z.string().min(1).max(80),
    markdown: z.string().min(1).max(8000),
  }),
  z.object({
    type: z.literal('record_document'),
    title: z.string().min(1).max(160),
    source_path: z.string().min(1).max(300),
    extracted_path: z.string().max(300).optional(),
    markdown: z.string().min(1).max(16000),
    tags: z.array(z.string().min(1).max(48)).max(16).default([]),
    aliases: z.array(z.string().min(1).max(160)).max(8).default([]),
    related_subjects: z.array(relatedSubjectSchema).max(12).default([]),
    project: z.string().max(120).optional(),
    note_path: z.string().max(240).optional(),
  }),
  z.object({
    type: z.literal('record_transcript'),
    title: z.string().min(1).max(160),
    transcript_path: z.string().min(1).max(300),
    markdown: z.string().min(1).max(12000),
    tags: z.array(z.string().min(1).max(48)).max(16).default([]),
    aliases: z.array(z.string().min(1).max(160)).max(8).default([]),
    related_subjects: z.array(relatedSubjectSchema).max(12).default([]),
    project: z.string().max(120).optional(),
    note_path: z.string().max(240).optional(),
  }),
]);

export const scribePlanSchema = z.object({
  summary: z.string().min(1).max(6000),
  confidence: confidenceSchema.default('medium'),
  sources: z.array(z.string().min(1).max(300)).max(16).default([]),
  notes_considered: z.array(z.string().min(1).max(240)).max(20).default([]),
  commit_summary: z.string().min(1).max(2000),
  actions: z.array(knowledgeActionSchema).max(20).default([]),
});

export type ScribePlan = z.infer<typeof scribePlanSchema>;
export type KnowledgeAction = z.infer<typeof knowledgeActionSchema>;
export type KnowledgeActionType = KnowledgeAction['type'];
export type SourceRef = z.infer<typeof sourceRefSchema>;
export type ResearchMemo = z.infer<typeof researchMemoSchema>;
