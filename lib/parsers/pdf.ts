import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ParsedComparisonRow, ParsedComparisonTable } from '@/lib/parsers/types';

const execFileAsync = promisify(execFile);
const EXTRACTION_TIMEOUT_MS = 20_000;
const MAX_TEXT_CHARS_IN_ROW = 12_000;

type ExtractedPdfPage = {
  page: number;
  text: string;
};

type PdfExtractionPayload = {
  ok: boolean;
  engine?: string;
  pages?: ExtractedPdfPage[];
  warnings?: string[];
  error?: string;
};

export async function parsePdfUpload(fileName: string, bytes: ArrayBuffer): Promise<ParsedComparisonTable> {
  const regulationName = stripExtension(fileName);
  const warnings: string[] = [
    'PDF 파서는 서버 전용 adapter boundary입니다. JS pdf-parse를 우선 사용하고 Python PyMuPDF/pdfplumber를 fallback으로 사용합니다. 스캔/OCR PDF는 MVP 범위에서 제외됩니다.',
  ];

  const extracted = await extractPdfText(fileName, bytes);
  warnings.push(...extracted.warnings);

  const pages = extracted.pages ?? [];
  const rows = parseComparisonRowsFromExtractedText(pages, warnings);

  if (extracted.engine) {
    warnings.push(`PDF text extraction engine: ${extracted.engine}`);
  }

  if (!extracted.available) {
    warnings.push(
      'PDF 텍스트 추출 도구를 사용할 수 없습니다. pdf-parse 의존성을 확인하거나 서버에 python3와 PyMuPDF(fitz) 또는 pdfplumber를 설치하면 fallback이 활성화됩니다.',
    );
  }

  if (extracted.available && pages.length > 0 && rows.length === 0) {
    warnings.push('PDF 텍스트는 추출했지만 신구조문 대비표 행을 안정적으로 감지하지 못했습니다. 원문 확인용 행만 제공합니다.');
    const text = joinPages(pages).trim();
    if (text) {
      rows.push({
        id: 'pdf-text-1',
        article: 'PDF 추출 원문',
        oldText: '',
        newText: text.slice(0, MAX_TEXT_CHARS_IN_ROW),
        confidence: 0.3,
        warnings: [
          '자동 대비표 구조화 실패: PDF 원문 텍스트를 검토용으로 노출합니다.',
          ...(text.length > MAX_TEXT_CHARS_IN_ROW ? ['원문이 길어 앞부분만 포함했습니다.'] : []),
        ],
      });
    }
  }

  if (extracted.available && pages.length === 0) {
    warnings.push('PDF에서 추출 가능한 텍스트를 찾지 못했습니다. 이미지 기반 PDF일 수 있습니다. OCR은 현재 제외 범위입니다.');
  }

  return {
    regulationName,
    sourceKind: 'upload',
    sourceFormat: 'pdf',
    rows,
    warnings,
  };
}

async function extractPdfText(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<{ available: boolean; engine?: string; pages?: ExtractedPdfPage[]; warnings: string[] }> {
  const jsExtracted = await extractPdfTextWithPdfParseChildProcess(fileName, bytes);
  if (jsExtracted.available && (jsExtracted.pages?.length ?? 0) > 0) return jsExtracted;

  const pythonExtracted = await extractPdfTextWithPython(fileName, bytes);
  return {
    available: jsExtracted.available || pythonExtracted.available,
    engine: pythonExtracted.engine ?? jsExtracted.engine,
    pages: pythonExtracted.pages?.length ? pythonExtracted.pages : jsExtracted.pages,
    warnings: [...jsExtracted.warnings, ...pythonExtracted.warnings],
  };
}

async function extractPdfTextWithPdfParseChildProcess(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<{ available: boolean; engine?: string; pages?: ExtractedPdfPage[]; warnings: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'regdiff-pdf-js-'));
  const pdfPath = path.join(dir, safeFileName(fileName));
  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'extract-pdf-text.mjs');

  try {
    await writeFile(pdfPath, Buffer.from(bytes));
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, pdfPath], {
      timeout: EXTRACTION_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    const payload = JSON.parse(stdout) as PdfExtractionPayload;
    if (stderr.trim()) payload.warnings = [...(payload.warnings ?? []), `pdf-parse adapter stderr: ${stderr.trim()}`];

    return {
      available: payload.ok,
      engine: payload.engine,
      pages: payload.pages ?? [],
      warnings: payload.warnings ?? (payload.ok ? [] : [payload.error ?? 'JS pdf-parse adapter failed']),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      pages: [],
      warnings: [`JS pdf-parse child-process adapter 실행 실패: ${message}`],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function extractPdfTextWithPython(
  fileName: string,
  bytes: ArrayBuffer,
): Promise<{ available: boolean; engine?: string; pages?: ExtractedPdfPage[]; warnings: string[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'regdiff-pdf-'));
  const pdfPath = path.join(dir, safeFileName(fileName));
  const scriptPath = path.join(/*turbopackIgnore: true*/ process.cwd(), 'scripts', 'extract-pdf-text.py');

  try {
    await writeFile(pdfPath, Buffer.from(bytes));
    const payload = await runExtractor(scriptPath, pdfPath);

    if (!payload.ok) {
      return {
        available: payload.error !== 'missing-python-dependency',
        engine: payload.engine,
        pages: [],
        warnings: payload.warnings?.length ? payload.warnings : [payload.error ?? 'PDF 텍스트 추출에 실패했습니다.'],
      };
    }

    return {
      available: true,
      engine: payload.engine,
      pages: (payload.pages ?? []).filter((page) => page.text.trim()),
      warnings: payload.warnings ?? [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      pages: [],
      warnings: [`PDF Python adapter 실행 실패: ${message}`],
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runExtractor(scriptPath: string, pdfPath: string): Promise<PdfExtractionPayload> {
  const pythonCandidates = ['python3', 'python'];
  const failures: string[] = [];

  for (const python of pythonCandidates) {
    try {
      const { stdout, stderr } = await execFileAsync(python, [scriptPath, pdfPath], {
        timeout: EXTRACTION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout) as PdfExtractionPayload;
      if (stderr.trim()) {
        parsed.warnings = [...(parsed.warnings ?? []), `PDF adapter stderr: ${stderr.trim()}`];
      }
      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${python}: ${message}`);
    }
  }

  return {
    ok: false,
    error: 'python-unavailable',
    warnings: [`Python 실행 파일을 찾거나 실행하지 못했습니다. ${failures.join(' / ')}`],
  };
}

function parseComparisonRowsFromExtractedText(pages: ExtractedPdfPage[], tableWarnings: string[]): ParsedComparisonRow[] {
  const text = joinPages(pages);
  const koreanRows = parseKoreanComparisonBlocks(text);
  const rows = koreanRows.length
    ? koreanRows
    : [
        ...parseLabelledBlocks(text),
        ...parseWhitespaceTableRows(text),
      ];

  const deduped = new Map<string, ParsedComparisonRow>();
  for (const row of rows) {
    const key = `${row.article ?? ''}\n${row.oldText}\n${row.newText}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }

  if (deduped.size > 0) {
    tableWarnings.push('PDF 대비표 행은 휴리스틱으로 추출되었습니다. HWPX/HTML보다 신뢰도가 낮으므로 원문 확인이 필요합니다.');
  }

  return [...deduped.values()].map((row, index) => ({ ...row, id: `pdf-${index + 1}` }));
}

function parseKoreanComparisonBlocks(text: string): ParsedComparisonRow[] {
  const compactText = text.replace(/\t/g, ' ');
  const rows: ParsedComparisonRow[] = [];

  if (!/신[․·ㆍ･]?구\s*조문\s*대비표/.test(compactText)) return rows;

  const articleMatch = compactText.match(/<\s*(별표\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\w-]*[_\s]*[^>]+)>/);
  const article = articleMatch?.[1]?.replace(/_/g, ' ').replace(/\s+/g, ' ').trim() ?? 'PDF 신구조문 대비표';
  const reason = compactText.match(/가\.\s*개정사유\s*([\s\S]*?)\n\s*나\.\s*주요\s*개정내용/)?.[1];
  const tableStart = compactText.search(/다\.\s*신[․·ㆍ･]?구\s*조문\s*대비표/);
  if (tableStart === -1) return rows;

  const tableText = compactText.slice(tableStart).replace(/\s+-- \d+ of \d+ --\s+/g, '\n');
  const revisedMarker = tableText.search(/<\s*별표[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ\w-]*[_\s]*[^>]*>\s*\(\s*개정/);
  const headerMatch = tableText.match(/현\s*행\s*개\s*정\(안\)\s*비고/);
  const headerEnd = headerMatch?.index === undefined ? -1 : headerMatch.index + headerMatch[0].length;

  if (revisedMarker > -1) {
    const oldStart = headerEnd > -1 ? headerEnd : 0;
    const oldText = cleanText(tableText.slice(oldStart, revisedMarker));
    const newText = cleanText(tableText.slice(revisedMarker));
    if (oldText || newText) {
      rows.push({
        id: 'pdf-korean-table-1',
        article,
        oldText,
        newText,
        reason: cleanText(reason ?? '') || undefined,
        confidence: 0.62,
        warnings: ['한국어 신구조문 대비표 블록을 PDF 텍스트에서 휴리스틱으로 추출했습니다.'],
      });
    }
  }

  return rows;
}

function parseLabelledBlocks(text: string): ParsedComparisonRow[] {
  const rows: ParsedComparisonRow[] = [];
  const blockPattern = /(?:조문|조항|article)\s*[:：]?\s*([^\n]{0,80})\n+구\s*(?:조문|내용|현행)\s*[:：]\s*([\s\S]*?)\n+신\s*(?:조문|내용|개정안)\s*[:：]\s*([\s\S]*?)(?:\n+개정\s*사유\s*[:：]\s*([\s\S]*?))?(?=\n{2,}(?:조문|조항|article)\s*[:：]?|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = blockPattern.exec(text))) {
    const oldText = cleanText(match[2] ?? '');
    const newText = cleanText(match[3] ?? '');
    if (!oldText && !newText) continue;
    rows.push({
      id: `pdf-labelled-${rows.length + 1}`,
      article: cleanText(match[1] ?? '') || undefined,
      oldText,
      newText,
      reason: cleanText(match[4] ?? '') || undefined,
      confidence: 0.55,
      warnings: ['PDF 라벨 기반 휴리스틱으로 추출했습니다.'],
    });
  }

  return rows;
}

function parseWhitespaceTableRows(text: string): ParsedComparisonRow[] {
  const rows: ParsedComparisonRow[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (/^(현행|구\s*조문|개정안|신\s*조문|개정\s*사유)/.test(line)) continue;
    const columns = line.split(/\t+| {2,}/).map(cleanText).filter(Boolean);
    if (columns.length < 2) continue;

    const [first, second, third, ...rest] = columns;
    const looksLikeArticle = /^제\s*\d+\s*조|^별표|^부칙/.test(first);
    const article = looksLikeArticle ? first : undefined;
    const oldText = looksLikeArticle ? second : first;
    const newText = looksLikeArticle ? third ?? '' : second;
    const reason = looksLikeArticle ? [third && !newText ? third : undefined, ...rest].filter(Boolean).join(' ') : [third, ...rest].filter(Boolean).join(' ');

    if (!oldText || !newText) continue;
    rows.push({
      id: `pdf-table-${rows.length + 1}`,
      article,
      oldText,
      newText,
      reason: reason || undefined,
      confidence: 0.45,
      warnings: ['PDF 공백 구분 표 휴리스틱으로 추출했습니다.'],
    });
  }

  return rows;
}

function joinPages(pages: ExtractedPdfPage[]): string {
  return pages.map((page) => `[page ${page.page}]\n${page.text}`).join('\n\n');
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

function safeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^\p{L}\p{N}._-]+/gu, '_') || 'upload.pdf';
}
