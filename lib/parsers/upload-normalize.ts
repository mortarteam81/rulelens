import type { ParsedComparisonRow } from '@/lib/parsers/types';

export type ExtractedTable = string[][];

export function rowsFromExtractedTables(tables: ExtractedTable[], idPrefix: string): ParsedComparisonRow[] {
  const rows: ParsedComparisonRow[] = [];

  for (const table of tables) {
    for (const rawCells of table) {
      const cells = rawCells.map(cleanText).filter(Boolean);
      const mapped = mapComparisonCells(cells);
      if (!mapped) continue;

      const article = inferArticle(mapped.oldText, mapped.newText);
      const warnings: string[] = [];
      if (!article) warnings.push('조문 제목을 자동 식별하지 못했습니다.');

      rows.push({
        id: `${idPrefix}-${rows.length + 1}`,
        article,
        oldText: mapped.oldText,
        newText: mapped.newText,
        reason: mapped.reason,
        confidence: warnings.length ? 0.62 : mapped.reason ? 0.76 : 0.72,
        warnings,
      });
    }
  }

  return rows;
}

export function rowsFromPlainText(text: string, idPrefix: string): ParsedComparisonRow[] {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const comparisonRow = parsePlainTextComparisonTable(normalized, idPrefix);
  if (comparisonRow) return [comparisonRow];

  const sections = normalized
    .split(/(?=제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^\n]+\))?)/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 20);

  return (sections.length ? sections : [normalized]).map((section, index) => ({
    id: `${idPrefix}-${index + 1}`,
    article: inferArticle(section, section),
    oldText: index === 0 && sections.length === 0 ? '' : section,
    newText: section,
    confidence: sections.length ? 0.45 : 0.3,
    warnings: ['신구조문 대비표를 확정적으로 찾지 못해 본문 텍스트 단위로 추출했습니다.'],
  }));
}

export function cleanText(input: string): string {
  return input
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parsePlainTextComparisonTable(text: string, idPrefix: string): ParsedComparisonRow | undefined {
  const headerMatch = text.match(/현\s*행\s*\n+개\s*정\s*\(?안\)?\s*\n+(?:비고\s*\n+)?/u);
  if (!headerMatch || headerMatch.index === undefined) return undefined;

  const bodyStart = headerMatch.index + headerMatch[0].length;
  const body = text.slice(bodyStart).trim();
  const newStartMatch = body.match(/\n(?=<[^\n>]*별표[^\n>]*>\s*\(?개정|<[^\n>]*별표[^\n>]*>\s*\(?개정|부\s*칙\s*\n+①\s*\(시행일\)\s*이\s*개정)/u);
  if (!newStartMatch || newStartMatch.index === undefined || newStartMatch.index < 20) return undefined;

  const oldText = body.slice(0, newStartMatch.index).trim();
  const remainder = body.slice(newStartMatch.index).trim();
  const reasonMatch = remainder.match(/\n(?:입학정원\s*\n*)?조정(?:\s*\n+(?:입학정원\s*\n*)?조정)*\s*$/u);
  const newText = (reasonMatch && reasonMatch.index !== undefined ? remainder.slice(0, reasonMatch.index) : remainder).trim();
  const reason = reasonMatch ? cleanText(reasonMatch[0]) : undefined;
  if (!oldText || !newText) return undefined;

  return {
    id: `${idPrefix}-comparison-1`,
    article: inferArticle(oldText, newText) ?? inferAppendixTitle(oldText, newText),
    oldText,
    newText,
    reason,
    confidence: 0.58,
    warnings: ['텍스트 변환 결과에서 현행/개정안 표를 휴리스틱으로 분리했습니다. 원본 표 경계 확인이 필요합니다.'],
  };
}

function mapComparisonCells(cells: string[]): { oldText: string; newText: string; reason?: string } | undefined {
  if (cells.length < 2) return undefined;
  if (isHeaderRow(cells)) return undefined;

  const withoutIndex = /^\d+$/.test(cells[0]) && cells.length >= 3 ? cells.slice(1) : cells;
  const headerless = withoutIndex.filter((cell) => !/^(현행|개정안|개정\s*사유|구\s*조문|신\s*조문|비고)$/u.test(cell));
  if (headerless.length < 2) return undefined;

  const [oldText, newText, ...rest] = headerless;
  if (oldText.length < 2 && newText.length < 2) return undefined;

  return { oldText, newText, reason: rest.join('\n') || undefined };
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(' ');
  return /(현행|구\s*조문).*(개정안|신\s*조문)/u.test(joined) && joined.length < 80;
}

function inferArticle(...texts: string[]): string | undefined {
  for (const text of texts) {
    const match = text.match(/제\s*\d+\s*조(?:의\s*\d+)?\s*(?:\([^\n]+?\))?/u);
    if (match) return cleanText(match[0]).replace(/\s+/g, ' ');
  }
  return undefined;
}

function inferAppendixTitle(...texts: string[]): string | undefined {
  for (const text of texts) {
    const match = text.match(/<\s*별표\s*[ⅠI1ⅣV\d_-]*[^>]*>[^\n]*/u);
    if (match) return cleanText(match[0]);
  }
  return undefined;
}
