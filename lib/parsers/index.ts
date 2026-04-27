import type { ParsedComparisonTable } from '@/lib/parsers/types';
import type { SourceInput } from '@/lib/sources/types';
import { fetchSungshinLawChangeListHtml } from '@/lib/sources/sungshin-rules-client';
import { parseSungshinLawChangeListHtml } from '@/lib/sources/sungshin-rule-parser';
import { parseLegacyHwp } from '@/lib/parsers/hwp';
import { parseHwpx } from '@/lib/parsers/hwpx';

export async function parseSourceInput(input: SourceInput): Promise<ParsedComparisonTable> {
  if (input.kind === 'sungshin-url') {
    const html = await fetchSungshinLawChangeListHtml(input.url);
    return parseSungshinLawChangeListHtml(html);
  }

  if (input.kind === 'upload') {
    const sourceFormat = inferUploadFormat(input.fileName, input.mimeType);
    if (sourceFormat === 'hwpx') return parseHwpx(input.bytes, input.fileName);
    if (sourceFormat === 'hwp') return parseLegacyHwp(input.bytes, input.fileName);

    return {
      regulationName: stripExtension(input.fileName),
      sourceKind: 'upload',
      sourceFormat,
      rows: [],
      warnings: ['PDF/unknown 업로드 파서는 아직 safe boundary입니다. HWPX는 JS ZIP/XML, Legacy HWP는 JS HWP5 text prototype 또는 hwp5txt/pyhwp 어댑터로 처리합니다.'],
    };
  }

  return {
    regulationName: input.regulationName,
    sourceKind: 'manual',
    sourceFormat: 'text',
    rows: input.rows,
    warnings: [],
  };
}

function inferUploadFormat(fileName: string, mimeType: string): ParsedComparisonTable['sourceFormat'] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'hwp') return 'hwp';
  if (ext === 'hwpx') return 'hwpx';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'txt') return 'text';
  return 'unknown';
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export type { ParsedComparisonRow, ParsedComparisonTable, SourceFormat, SourceKind } from '@/lib/parsers/types';
