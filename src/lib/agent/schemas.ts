import { z } from 'zod';

export const classificationSchema = z.enum([
  'note',
  'task',
  'decision',
  'reminder',
  'project-update',
]);

export const entityTypeSchema = z.enum(['note', 'project', 'person', 'system', 'topic']);

export const relatedSubjectSchema = z.object({
  title: z.string().min(1).max(120),
  relation: z.string().min(1).max(120),
  entity_type: entityTypeSchema.default('note'),
  create_if_missing: z.boolean().default(true),
});

export const actionItemSchema = z.object({
  title: z.string().min(1).max(120),
  details: z.string().max(600).optional(),
  due_hint: z.string().max(120).optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const subjectUpdateSchema = z.object({
  title: z.string().min(1).max(120),
  entity_type: entityTypeSchema.default('note'),
  section: z.string().min(1).max(80),
  markdown: z.string().min(1).max(2400),
});

export const memoryTargetSchema = z.enum([
  'identity',
  'preferences',
  'principles',
  'open-questions',
]);

export const memoryUpdateSchema = z.object({
  target: memoryTargetSchema,
  section: z.string().min(1).max(80),
  markdown: z.string().min(1).max(2400),
});

export const capturePlanSchema = z.object({
  classification: classificationSchema,
  title: z.string().min(3).max(120),
  summary: z.string().min(1).max(320),
  note_markdown: z.string().min(1).max(8000),
  canonical_tags: z.array(z.string().min(1).max(32)).max(10).default([]),
  aliases: z.array(z.string().min(1).max(120)).max(6).default([]),
  related_subjects: z.array(relatedSubjectSchema).max(8).default([]),
  action_items: z.array(actionItemSchema).max(8).default([]),
  subject_updates: z.array(subjectUpdateSchema).max(10).default([]),
  memory_updates: z.array(memoryUpdateSchema).max(6).default([]),
  follow_ups: z.array(z.string().min(1).max(140)).max(5).default([]),
  status: z.string().max(40).optional(),
  project: z.string().max(120).optional(),
  reminder_time_hint: z.string().max(120).optional(),
  should_append_to_daily: z.boolean().default(true),
});

const noteDraftSchema = z.object({
  classification: classificationSchema.or(z.literal('note')),
  title: z.string().min(3).max(120),
  markdown: z.string().min(1).max(8000),
  tags: z.array(z.string().min(1).max(32)).max(10).default([]),
  aliases: z.array(z.string().min(1).max(120)).max(6).default([]),
  related_subjects: z.array(relatedSubjectSchema).max(8).default([]),
  status: z.string().max(40).optional(),
  project: z.string().max(120).optional(),
});

export const askActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_note'),
    note: noteDraftSchema,
  }),
  z.object({
    type: z.literal('create_task'),
    title: z.string().min(3).max(120),
    markdown: z.string().min(1).max(4000),
    tags: z.array(z.string().min(1).max(32)).max(10).default([]),
    related_subjects: z.array(relatedSubjectSchema).max(8).default([]),
    due_hint: z.string().max(120).optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  z.object({
    type: z.literal('append_to_note'),
    target: z.string().min(1).max(200),
    section: z.string().min(1).max(80),
    markdown: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('set_status'),
    target: z.string().min(1).max(200),
    status: z.string().min(1).max(40),
  }),
  z.object({
    type: z.literal('link_notes'),
    source: z.string().min(1).max(200),
    target: z.string().min(1).max(200),
    relation: z.string().min(1).max(120).optional(),
  }),
]);

export const askPlanSchema = z.object({
  answer: z.string().min(1).max(6000),
  citations: z.array(z.string().min(1).max(200)).max(12).default([]),
  actions: z.array(askActionSchema).max(10).default([]),
});

export const organizePlanSchema = z.object({
  summary: z.string().min(1).max(3000),
  actions: z.array(askActionSchema).max(12).default([]),
});

export type CapturePlan = z.infer<typeof capturePlanSchema>;
export type AskPlan = z.infer<typeof askPlanSchema>;
export type OrganizePlan = z.infer<typeof organizePlanSchema>;
export type AskAction = z.infer<typeof askActionSchema>;
