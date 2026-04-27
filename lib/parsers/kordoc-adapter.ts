import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { normalizeComparisonTable } from './normalize';
import type { ParsedComparisonTable, SourceFormat } from './types';

const execFileAsync = promisify(execFile);
const KORDOC_TIMEOUT_MS = 30_000;
const KORDOC_MAX_BUFFER = 16 * 1024 * 1024;
const LOCAL_NPX_KORDOC = ['--no-install', 'kordoc'] as const;

export type KordocBoundaryOperation = 'parse_document' | 'parse_table' | 'compare_documents';

export type KordocDetection = {
  available: boolean;
  mode: 'local-npx' | 'mcp-configured' | 'unavailable';
  command?: string;
  version?: string;
  warnings: string[];
};

export type KordocDocumentInput = {
  fileName: string;
  bytes: ArrayBuffer;
  sourceFormat: SourceFormat;
};

export type KordocParseDocumentResult = {
  ok: boolean;
  markdown: string;
  detection: KordocDetection;
  warnings: string[];
};

export type KordocCompareDocumentsInput = {
  previous: KordocDocumentInput;
  current: KordocDocumentInput;
  regulationName?: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

export type KordocCommandRunner = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<CommandResult>;

export type KordocAdapterOptions = {
  runner?: KordocCommandRunner;
  env?: NodeJS.ProcessEnv;
};

/**
 * Safe boundary for kordoc CLI/MCP integration.
 *
 * Current behavior intentionally does not run `kordoc setup` or mutate any MCP client config.
 * It can use an already-available local `npx --no-install kordoc` CLI, or report that a future
 * MCP configuration has been detected but is not wired into this server yet.
 */
export class KordocAdapter {
  private readonly runner: KordocCommandRunner;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: KordocAdapterOptions = {}) {
    this.runner = options.runner ?? defaultRunner;
    this.env = options.env ?? process.env;
  }

  async detect(): Promise<KordocDetection> {
    const mcpCommand = this.env.KORDOC_MCP_COMMAND?.trim();
    const mcpUrl = this.env.KORDOC_MCP_URL?.trim();
    if (mcpCommand || mcpUrl) {
      return {
        available: false,
        mode: 'mcp-configured',
        command: mcpCommand || mcpUrl,
        warnings: [
          'kordoc MCP 설정 힌트는 감지했지만, 이 앱은 아직 MCP transport를 직접 호출하지 않습니다.',
          '현재 Wave 3 경계는 MCP 클라이언트 설정을 수정하지 않고 graceful fallback만 제공합니다.',
        ],
      };
    }

    try {
      const result = await this.runner('npx', [...LOCAL_NPX_KORDOC, '--version'], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      return {
        available: true,
        mode: 'local-npx',
        command: 'npx --no-install kordoc',
        version: firstLine(result.stdout || result.stderr),
        warnings: result.stderr.trim() ? [`kordoc detection stderr: ${result.stderr.trim().slice(0, 500)}`] : [],
      };
    } catch (error) {
      return {
        available: false,
        mode: 'unavailable',
        command: 'npx --no-install kordoc',
        warnings: [
          `kordoc CLI를 찾지 못했습니다: ${messageOf(error)}`,
          '설치를 요구하지 않는 안전 감지만 수행했습니다. 필요 시 별도 환경에서 kordoc setup 또는 MCP 등록을 진행하세요.',
        ],
      };
    }
  }

  async parseDocument(input: KordocDocumentInput): Promise<KordocParseDocumentResult> {
    const detection = await this.detect();
    if (!detection.available) {
      return {
        ok: false,
        markdown: '',
        detection,
        warnings: [
          ...detection.warnings,
          'kordoc parse_document boundary unavailable: 기존 HWPX/HWP/PDF parser fallback을 사용해야 합니다.',
        ],
      };
    }

    const workDir = await mkdtemp(path.join(tmpdir(), 'regdiff-kordoc-'));
    const filePath = path.join(workDir, safeFileName(input.fileName));

    try {
      await writeFile(filePath, Buffer.from(input.bytes));
      const result = await this.runner('npx', [...LOCAL_NPX_KORDOC, filePath], {
        timeout: KORDOC_TIMEOUT_MS,
        maxBuffer: KORDOC_MAX_BUFFER,
      });
      const markdown = result.stdout.trim();
      return {
        ok: markdown.length > 0,
        markdown,
        detection,
        warnings: [
          ...detection.warnings,
          'kordoc parse_document 결과는 Markdown adapter output입니다. 원본 parser confidence와 함께 검증하세요.',
          ...(result.stderr.trim() ? [`kordoc parse_document stderr: ${result.stderr.trim().slice(0, 1000)}`] : []),
          ...(markdown ? [] : ['kordoc parse_document가 빈 출력을 반환했습니다.']),
        ],
      };
    } catch (error) {
      return {
        ok: false,
        markdown: '',
        detection,
        warnings: [`kordoc parse_document 실행 실패: ${messageOf(error)}`],
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  async parseTable(input: KordocDocumentInput): Promise<ParsedComparisonTable> {
    const parsed = await this.parseDocument(input);
    if (!parsed.ok) {
      return emptyTable(input, [
        ...parsed.warnings,
        'kordoc parse_table boundary unavailable: 신구조문 대비표 구조화는 기존 parser 또는 수동 입력으로 대체하세요.',
      ]);
    }

    const normalized = normalizeComparisonTable(stripMarkdownSeparatorRows(parsed.markdown), {
      regulationName: stripExtension(input.fileName),
      sourceKind: 'upload',
      sourceFormat: input.sourceFormat,
      idPrefix: 'kordoc',
    });

    return {
      ...normalized,
      warnings: [
        ...parsed.warnings,
        'kordoc parse_table은 kordoc Markdown 표를 regdiff 정규화기로 변환합니다. 복잡한 표는 원문 대조가 필요합니다.',
        ...normalized.warnings,
      ],
    };
  }

  async compareDocuments(input: KordocCompareDocumentsInput): Promise<ParsedComparisonTable> {
    const detection = await this.detect();
    if (!detection.available) {
      return emptyTable(input.current, [
        ...detection.warnings,
        'kordoc compare_documents boundary unavailable: 현재는 기존 hybrid comparison pipeline으로 대체해야 합니다.',
      ], input.regulationName);
    }

    return emptyTable(input.current, [
      ...detection.warnings,
      'kordoc compare_documents CLI/MCP 인자 계약은 아직 고정하지 않았습니다.',
      'Wave 3에서는 adapter boundary만 정의합니다. 추후 MCP tool schema가 고정되면 previous/current 문서를 직접 전달하도록 확장하세요.',
    ], input.regulationName);
  }
}

export async function detectKordoc(options?: KordocAdapterOptions): Promise<KordocDetection> {
  return new KordocAdapter(options).detect();
}

export async function parseDocumentWithKordoc(input: KordocDocumentInput, options?: KordocAdapterOptions): Promise<KordocParseDocumentResult> {
  return new KordocAdapter(options).parseDocument(input);
}

export async function parseTableWithKordoc(input: KordocDocumentInput, options?: KordocAdapterOptions): Promise<ParsedComparisonTable> {
  return new KordocAdapter(options).parseTable(input);
}

export async function compareDocumentsWithKordoc(input: KordocCompareDocumentsInput, options?: KordocAdapterOptions): Promise<ParsedComparisonTable> {
  return new KordocAdapter(options).compareDocuments(input);
}

async function defaultRunner(file: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    encoding: 'utf8',
  });
  return { stdout, stderr };
}

function emptyTable(input: KordocDocumentInput, warnings: string[], regulationName = stripExtension(input.fileName)): ParsedComparisonTable {
  return {
    regulationName,
    sourceKind: 'upload',
    sourceFormat: input.sourceFormat,
    rows: [],
    warnings,
  };
}

function firstLine(input: string): string | undefined {
  return input.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeFileName(fileName: string): string {
  return `${randomUUID()}-${path.basename(fileName).replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'document'}`;
}

function stripMarkdownSeparatorRows(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
    .join('\n');
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
