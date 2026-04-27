import type { ParsedComparisonTable } from '@/lib/parsers/types';
import type { SourceInput } from '@/lib/sources/types';
import { fetchSungshinLawChangeListHtml } from '@/lib/sources/sungshin-rules-client';
import { parseSungshinLawChangeListHtml } from '@/lib/sources/sungshin-rule-parser';

export async function parseSourceInput(input: SourceInput): Promise<ParsedComparisonTable> {
  if (input.kind === 'sungshin-url') {
    const html = await fetchSungshinLawChangeListHtml(input.url);
    return parseSungshinLawChangeListHtml(html);
  }

  if (input.kind === 'upload') {
    return {
      regulationName: stripExtension(input.fileName),
      sourceKind: 'upload',
      sourceFormat: inferUploadFormat(input.fileName, input.mimeType),
      rows: [],
      warnings: ['HWP/PDF 업로드 파서는 아직 placeholder boundary입니다. 실제 파일 파싱은 다음 패치에서 연결합니다.'],
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
