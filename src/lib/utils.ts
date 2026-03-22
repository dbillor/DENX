import path from 'node:path';

export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampId(prefix: string): string {
  const compact = nowIso().replace(/[-:.]/g, '').replace('T', '-').replace('Z', '');
  return `${prefix}_${compact}`;
}

export function slugifyText(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'untitled';
}

export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const rawValue of values) {
    const value = `${rawValue ?? ''}`.trim();
    if (!value) {
      continue;
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(value);
  }

  return items;
}

export function canonicalizeTag(value: string): string {
  return slugifyText(value.replace(/^#/, '').replace(/\//g, '-'));
}

export function normalizeRef(value: string): string {
  const cleaned = value
    .replace(/^\[\[/, '')
    .replace(/\]\]$/, '')
    .replace(/\.md$/i, '')
    .replace(/\\/g, '/')
    .replace(/^\//, '')
    .trim();

  return cleaned
    .split('/')
    .filter(Boolean)
    .map((segment) => slugifyText(segment))
    .join('/');
}

export function extractWikiLinks(markdown: string): string[] {
  const matches = markdown.matchAll(/\[\[([^[\]|#]+)(?:#[^[\]|]+)?(?:\|[^[\]]+)?\]\]/g);
  return uniqueStrings(Array.from(matches, (match) => normalizeRef(match[1] ?? '')));
}

export function extractTags(markdown: string): string[] {
  const matches = markdown.matchAll(/(^|\s)#([a-z0-9][\w/-]*)/gi);
  return uniqueStrings(Array.from(matches, (match) => canonicalizeTag(match[2] ?? '')));
}

export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^|\]]+)\|?([^|\]]*)\]\]/g, (_full, target, alias) => alias || target)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_>~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripLeadingFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/u, '').trimStart();
}

export function truncate(value: string, maxLength = 280): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function tokenize(value: string): string[] {
  return uniqueStrings(
    value
      .toLowerCase()
      .split(/[^a-z0-9/.-]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  );
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceManagedBlock(
  content: string,
  marker: string,
  heading: string,
  lines: string[],
): string {
  const start = `<!-- voice-kb:${marker}:start -->`;
  const end = `<!-- voice-kb:${marker}:end -->`;
  const blockRegex = new RegExp(
    `\\n*${escapeRegExp(`## ${heading}`)}\\n${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n*`,
    'm',
  );
  const block =
    lines.length > 0
      ? `## ${heading}\n${start}\n${lines.join('\n')}\n${end}`
      : '';

  const stripped = content.replace(blockRegex, '').trimEnd();
  if (!block) {
    return `${stripped}\n`;
  }

  return `${stripped}\n\n${block}\n`;
}

export function appendUnderHeading(content: string, heading: string, markdown: string): string {
  const normalized = content.trimEnd();
  const headingLine = `## ${heading}`;
  const lines = normalized ? normalized.split('\n') : [];
  const index = lines.findIndex((line) => line.trim() === headingLine);
  const addition = markdown.trim();

  if (index === -1) {
    return `${normalized}\n\n${headingLine}\n${addition}\n`;
  }

  let insertIndex = lines.length;
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    if (lines[cursor]?.startsWith('## ')) {
      insertIndex = cursor;
      break;
    }
  }

  const before = lines.slice(0, insertIndex);
  const after = lines.slice(insertIndex);
  if (before.at(-1)?.trim()) {
    before.push('');
  }
  before.push(addition);
  before.push('');

  return `${[...before, ...after].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function relativePath(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

export function absolutePath(root: string, target: string): string {
  return path.isAbsolute(target) ? target : path.join(root, target);
}

export function formatDateForDailyNote(input: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(input));
}

export function formatTimeForDailyLog(input: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(input));
}
