import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AppConfig } from '../config.js';
import type { VaultNoteRecord } from '../types.js';
import { canonicalizeTag, nowIso, slugifyText, stripMarkdown, truncate } from '../utils.js';
import { VaultStore } from '../vault/VaultStore.js';
import { VaultAssistantService } from './VaultAssistantService.js';

const execFileAsync = promisify(execFile);

export interface DocumentIngestOptions {
  title?: string;
  project?: string;
  tags?: string[];
  capturedAt?: string;
}

export interface DocumentIngestResult {
  documentId: string;
  sourcePath: string;
  extractionPath: string;
  extractedText: string;
  extractionFailed: boolean;
  plan?: Awaited<ReturnType<VaultAssistantService['runTask']>>['plan'];
  touchedNotes: VaultNoteRecord[];
}

export class DocumentIngestionService {
  constructor(
    private readonly vault: VaultStore,
    private readonly assistant: VaultAssistantService,
    private readonly config: AppConfig,
  ) {}

  async ingestDocument(inputPath: string, options: DocumentIngestOptions = {}): Promise<DocumentIngestResult> {
    await this.vault.ensureStructure();

    const capturedAt = this.normalizeCapturedAt(options.capturedAt);
    const absoluteInput = path.resolve(this.config.workspaceRoot, inputPath);
    const originalName = path.basename(absoluteInput);
    const slug = slugifyText(options.title ?? path.parse(originalName).name);
    const documentId = `doc_${Date.now()}`;
    const extension = path.extname(originalName) || '.txt';
    const sourcePath = this.vault.documentSourcePath(documentId, capturedAt, slug, extension);
    const extractionPath = this.vault.documentExtractionPath(documentId, capturedAt);

    const buffer = await fs.readFile(absoluteInput);
    await this.vault.saveBinary(sourcePath, buffer);

    const extraction = await this.extractText(absoluteInput, extension);
    const extractionDocument = this.buildExtractionDocument({
      documentId,
      title: options.title ?? path.parse(originalName).name,
      sourcePath,
      extractedText: extraction.text,
      failed: extraction.failed,
      error: extraction.error,
      capturedAt,
    });
    await this.vault.saveText(extractionPath, extractionDocument);

    if (extraction.failed || !extraction.text.trim()) {
      return {
        documentId,
        sourcePath,
        extractionPath,
        extractedText: extraction.text,
        extractionFailed: true,
        touchedNotes: [],
      };
    }

    const summary = truncate(stripMarkdown(extraction.text), 1200);
    const title = options.title ?? path.parse(originalName).name;
    const execution = await this.assistant.runTask({
      mode: 'document',
      requestText: [
        `Source document title: ${title}`,
        options.project ? `Project: ${options.project}` : undefined,
        options.tags?.length ? `Tags: ${options.tags.join(', ')}` : undefined,
        '',
        summary,
      ]
        .filter(Boolean)
        .join('\n'),
      capturedAt,
      sourceKind: 'document',
      sourceRefs: [
        {
          kind: 'document-source',
          path: sourcePath,
          label: originalName,
          mime_type: this.mimeTypeForExtension(extension),
        },
        {
          kind: 'document-extraction',
          path: extractionPath,
          label: `${title} extraction`,
          mime_type: 'text/markdown',
        },
      ],
    });

    return {
      documentId,
      sourcePath,
      extractionPath,
      extractedText: extraction.text,
      extractionFailed: false,
      plan: execution.plan,
      touchedNotes: execution.touchedNotes,
    };
  }

  private async extractText(
    absoluteInput: string,
    extension: string,
  ): Promise<{ text: string; failed: boolean; error?: string }> {
    const normalizedExt = extension.toLowerCase();
    if (normalizedExt === '.md' || normalizedExt === '.markdown' || normalizedExt === '.txt') {
      return {
        text: await fs.readFile(absoluteInput, 'utf8'),
        failed: false,
      };
    }

    if (normalizedExt === '.pdf') {
      try {
        const scriptPath = path.join(this.config.workspaceRoot, 'scripts', 'extract_pdf_text.py');
        const { stdout } = await execFileAsync('python3', [scriptPath, absoluteInput], {
          cwd: this.config.workspaceRoot,
          maxBuffer: 1024 * 1024 * 16,
        });
        const text = stdout.trim();
        return {
          text,
          failed: !text,
          error: text ? undefined : 'PDF extraction returned no text.',
        };
      } catch (error) {
        return {
          text: '',
          failed: true,
          error:
            error instanceof Error ? error.message : 'PDF extraction failed unexpectedly.',
        };
      }
    }

    return {
      text: '',
      failed: true,
      error: `Unsupported document extension "${normalizedExt}".`,
    };
  }

  private buildExtractionDocument(options: {
    documentId: string;
    title: string;
    sourcePath: string;
    extractedText: string;
    failed: boolean;
    error?: string;
    capturedAt: string;
  }): string {
    const status = options.failed ? 'failed' : 'extracted';
    const lines = [
      `# Extraction ${options.documentId}`,
      '',
      `- Title: ${options.title}`,
      `- Source document: ${options.sourcePath}`,
      `- Status: ${status}`,
      `- Captured at: ${options.capturedAt}`,
      ...(options.error ? [`- Error: ${options.error}`] : []),
      '',
      '## Extracted Text',
      options.extractedText.trim() || '_No text extracted._',
    ];

    return lines.join('\n');
  }

  private mimeTypeForExtension(extension: string): string {
    switch (extension.toLowerCase()) {
      case '.md':
      case '.markdown':
        return 'text/markdown';
      case '.txt':
        return 'text/plain';
      case '.pdf':
        return 'application/pdf';
      default:
        return 'application/octet-stream';
    }
  }

  private normalizeCapturedAt(value?: string): string {
    if (!value?.trim()) {
      return nowIso();
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return nowIso();
    }

    return parsed.toISOString();
  }
}
