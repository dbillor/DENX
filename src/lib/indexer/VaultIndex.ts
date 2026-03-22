import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

import type { IndexNoteSummary, SearchResult, VaultGraphIndex, VaultNoteFrontmatter } from '../types.js';
import {
  extractTags,
  extractWikiLinks,
  normalizeRef,
  stripMarkdown,
  tokenize,
  truncate,
  uniqueStrings,
} from '../utils.js';
import { normalizeFrontmatter } from '../vault/frontmatter.js';

export class VaultIndex {
  constructor(private readonly vaultRoot: string) {}

  get indexPath(): string {
    return path.join(this.vaultRoot, '_system', 'index.json');
  }

  async build(): Promise<VaultGraphIndex> {
    const files = await fg(['**/*.md', '!_system/**'], {
      cwd: this.vaultRoot,
      absolute: true,
      dot: false,
    });

    const notes: IndexNoteSummary[] = [];
    const slugLookup = new Map<string, string>();

    for (const file of files) {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = matter(raw);
      const relativeFile = path.relative(this.vaultRoot, file).replace(/\\/g, '/');
      const slug = relativeFile.replace(/\.md$/i, '');
      const defaultTitle = path.basename(slug).replace(/-/g, ' ');
      const frontmatter = normalizeFrontmatter(parsed.data as Record<string, unknown>, {
        title: defaultTitle,
        type: 'reference',
      });

      const links = uniqueStrings([
        ...extractWikiLinks(parsed.content),
        ...frontmatter.related.map((ref) => normalizeRef(ref)),
      ]).filter((ref) => ref && ref !== slug);

      const note: IndexNoteSummary = {
        id: frontmatter.id,
        title: frontmatter.title,
        type: frontmatter.type,
        status: frontmatter.status,
        path: relativeFile,
        slug,
        tags: uniqueStrings([...frontmatter.tags, ...extractTags(parsed.content)]),
        aliases: frontmatter.aliases,
        outgoingLinks: links,
        incomingLinks: [],
        excerpt: truncate(stripMarkdown(parsed.content), 280),
        created: frontmatter.created,
        updated: frontmatter.updated,
      };

      notes.push(note);

      for (const candidate of [slug, relativeFile, path.basename(slug), frontmatter.title, ...frontmatter.aliases]) {
        slugLookup.set(normalizeRef(candidate), slug);
      }
    }

    for (const note of notes) {
      note.outgoingLinks = uniqueStrings(
        note.outgoingLinks.map((ref) => slugLookup.get(normalizeRef(ref)) ?? normalizeRef(ref)),
      ).filter((ref) => ref !== note.slug);
    }

    const incomingLookup = new Map<string, string[]>();
    for (const note of notes) {
      for (const target of note.outgoingLinks) {
        const incoming = incomingLookup.get(target) ?? [];
        incoming.push(note.slug);
        incomingLookup.set(target, incoming);
      }
    }

    for (const note of notes) {
      note.incomingLinks = uniqueStrings(incomingLookup.get(note.slug) ?? []);
    }

    const index: VaultGraphIndex = {
      generatedAt: new Date().toISOString(),
      notes: notes.sort((left, right) => right.updated.localeCompare(left.updated)),
    };

    await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fs.writeFile(this.indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

    return index;
  }

  async loadOrBuild(): Promise<VaultGraphIndex> {
    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      return JSON.parse(raw) as VaultGraphIndex;
    } catch {
      return this.build();
    }
  }

  async search(query: string, limit = 8): Promise<SearchResult[]> {
    const index = await this.loadOrBuild();
    const tokens = tokenize(query);
    const normalizedQuery = normalizeRef(query);
    const queryIsEmpty = !tokens.length && !normalizedQuery;

    const scored = index.notes
      .map((note) => {
        const title = note.title.toLowerCase();
        const aliases = note.aliases.join(' ').toLowerCase();
        const tags = note.tags.join(' ').toLowerCase();
        const status = `${note.status ?? ''}`.toLowerCase();
        const pathValue = note.path.toLowerCase();
        const excerpt = note.excerpt.toLowerCase();
        const links = `${note.outgoingLinks.join(' ')} ${note.incomingLinks.join(' ')}`.toLowerCase();
        let score = 0;

        if (queryIsEmpty) {
          score = 1;
        }

        if (normalizedQuery && normalizeRef(note.slug) === normalizedQuery) {
          score += 20;
        }

        if (normalizedQuery && normalizeRef(note.title) === normalizedQuery) {
          score += 16;
        }

        if (normalizedQuery && title.includes(normalizedQuery.replace(/\//g, ' '))) {
          score += 10;
        }

        for (const token of tokens) {
          if (title.includes(token)) {
            score += 6;
          }
          if (aliases.includes(token)) {
            score += 5;
          }
          if (tags.includes(token)) {
            score += 4;
          }
          if (pathValue.includes(token)) {
            score += 3;
          }
          if (`${note.type}`.includes(token)) {
            score += 3;
          }
          if (status.includes(token)) {
            score += 1;
          }
          if (excerpt.includes(token)) {
            score += 2;
          }
          if (links.includes(token)) {
            score += 1;
          }
        }

        if (status === 'no-action') {
          score -= 6;
        }

        if (note.tags.includes('system-test')) {
          score -= 4;
        }

        if (note.tags.includes('needs-context')) {
          score -= 4;
        }

        return {
          ...note,
          score,
          absolutePath: path.join(this.vaultRoot, note.path),
        };
      })
      .filter((note) => note.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.updated.localeCompare(left.updated);
      });

    return scored.slice(0, limit);
  }

  async resolveRef(reference: string): Promise<IndexNoteSummary | null> {
    const normalized = normalizeRef(reference);
    if (!normalized) {
      return null;
    }

    const index = await this.loadOrBuild();
    const exact =
      index.notes.find((note) => normalizeRef(note.slug) === normalized) ??
      index.notes.find((note) => normalizeRef(note.path) === normalized) ??
      index.notes.find((note) => normalizeRef(path.basename(note.slug)) === normalized) ??
      index.notes.find((note) => normalizeRef(note.title) === normalized) ??
      index.notes.find((note) => note.aliases.some((alias) => normalizeRef(alias) === normalized));

    if (exact) {
      return exact;
    }

    return (
      index.notes.find((note) => normalizeRef(note.title).includes(normalized)) ??
      index.notes.find((note) => normalizeRef(note.slug).includes(normalized)) ??
      null
    );
  }
}
