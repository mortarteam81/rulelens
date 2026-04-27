import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { ParsedComparisonTable } from '@/lib/parsers/types';
import { cleanText, rowsFromExtractedTables, rowsFromPlainText, type ExtractedTable } from '@/lib/parsers/upload-normalize';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
});

export async function parseHwpx(bytes: ArrayBuffer, fileName: string): Promise<ParsedComparisonTable> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(bytes);
  const sectionFiles = Object.values(zip.files)
    .filter((file) => !file.dir && /(?:^|\/)section\d+\.xml$/i.test(file.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (sectionFiles.length === 0) {
    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwpx',
      rows: [],
      warnings: ['HWPX ZIP 안에서 Contents/section*.xml 본문 파일을 찾지 못했습니다.'],
    };
  }

  const tables: ExtractedTable[] = [];
  const plainParts: string[] = [];

  for (const file of sectionFiles) {
    const xml = await file.async('text');
    const doc = parser.parse(xml);
    tables.push(...extractTables(doc));
    plainParts.push(extractText(doc));
  }

  const rows = rowsFromExtractedTables(tables, 'hwpx');
  if (tables.length === 0) warnings.push('HWPX 본문에서 표 구조를 찾지 못했습니다.');
  if (rows.length === 0) warnings.push('신구조문 대비표 형식의 행을 자동 식별하지 못했습니다.');

  return {
    regulationName: stripExtension(fileName),
    sourceKind: 'upload',
    sourceFormat: 'hwpx',
    rows: rows.length ? rows : rowsFromPlainText(plainParts.join('\n\n'), 'hwpx-text'),
    warnings,
  };
}

function extractTables(node: unknown): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  walk(node, (candidate) => {
    if (!isRecord(candidate)) return;
    const tableNode = candidate.tbl;
    if (!tableNode) return;
    for (const table of asArray(tableNode)) {
      const rows = asArray(isRecord(table) ? table.tr : undefined)
        .map((tr) => asArray(isRecord(tr) ? tr.tc : undefined).map((tc) => cleanText(extractText(tc))))
        .filter((row) => row.some(Boolean));
      if (rows.length) tables.push(rows);
    }
  });
  return tables;
}

function extractText(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return node.map(extractText).filter(Boolean).join('\n');
  if (!isRecord(node)) return '';

  const parts: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_')) continue;
    if (key === '#text') parts.push(String(value));
    else parts.push(extractText(value));
  }
  return cleanText(parts.filter(Boolean).join('\n'));
}

function walk(node: unknown, visitor: (node: unknown) => void): void {
  visitor(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visitor);
    return;
  }
  if (!isRecord(node)) return;
  for (const value of Object.values(node)) walk(value, visitor);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
