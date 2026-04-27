import type { ParsedComparisonRow, ParsedComparisonTable, SourceFormat, SourceKind } from '@/lib/parsers/types';

export type RawComparisonRow = Record<string, unknown> | unknown[];

export type NormalizeComparisonTableOptions = {
  regulationName?: string;
  sourceKind?: SourceKind;
  sourceFormat?: SourceFormat;
  currentHistory?: string;
  previousHistory?: string;
  idPrefix?: string;
};

export type NormalizeComparisonRowsOptions = {
  idPrefix?: string;
  startIndex?: number;
};

type CanonicalColumn = 'article' | 'oldText' | 'newText' | 'reason' | 'note' | 'page';

type RowCandidate = {
  values: Record<CanonicalColumn, string | undefined>;
  sourceIndex: number;
};

const HEADER_ALIASES: Record<CanonicalColumn, RegExp[]> = {
  article: [/^조문$/, /^조항$/, /^조문명$/, /^항목$/, /^대상조문$/, /^구분$/],
  oldText: [/^현행$/, /^현행규정$/, /^현행조문$/, /^현행내용$/, /^개정전$/, /^개정전문$/, /^종전$/, /^종전규정$/, /^구조문$/, /^구조항$/, /^기존$/, /^기존조문$/],
  newText: [/^개정안$/, /^개정후$/, /^개정후문$/, /^개정내용$/, /^변경안$/, /^신조문$/, /^신구조문$/, /^개정조문$/, /^개정규정$/, /^수정안$/],
  reason: [/^개정사유$/, /^개정이유$/, /^사유$/, /^제안이유$/, /^주요내용$/, /^비교$/, /^변경사유$/],
  note: [/^비고$/, /^참고$/, /^메모$/, /^특이사항$/],
  page: [/^쪽$/, /^페이지$/, /^page$/i],
};

const ARTICLE_PATTERN = /(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*\([^)]*\))?|부\s*칙|별\s*표\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVXivx\d]*|별\s*지\s*제?\s*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVXivx\d]*\s*호?)/;
const CREATED_MARKER = /^(?:<\s*)?신\s*설(?:\s*>)?$/;
const DELETED_MARKER = /^(?:<\s*)?삭\s*제(?:\s*>)?$/;
const OMITTED_MARKER = /^(?:해당\s*없음|없음|-)$/;

export function normalizeComparisonTable(
  input: string | RawComparisonRow[],
  options: NormalizeComparisonTableOptions = {},
): ParsedComparisonTable {
  const warnings: string[] = [];
  const rowCandidates = typeof input === 'string' ? parseRawComparisonText(input, warnings) : normalizeRawRowCandidates(input, warnings);
  const rows = normalizeComparisonRows(rowCandidates, { idPrefix: options.idPrefix });

  if (rows.length === 0) warnings.push('정규화 가능한 신구조문 대비표 행을 찾지 못했습니다.');

  return {
    regulationName: options.regulationName,
    sourceKind: options.sourceKind ?? 'upload',
    sourceFormat: options.sourceFormat ?? (typeof input === 'string' ? 'text' : 'unknown'),
    currentHistory: options.currentHistory,
    previousHistory: options.previousHistory,
    rows,
    warnings,
  };
}

export function normalizeComparisonRows(
  input: RowCandidate[] | RawComparisonRow[],
  options: NormalizeComparisonRowsOptions = {},
): ParsedComparisonRow[] {
  const warnings: string[] = [];
  const candidates = isRowCandidateArray(input) ? input : normalizeRawRowCandidates(input, warnings);
  const startIndex = options.startIndex ?? 1;
  const idPrefix = options.idPrefix ?? 'normalized';

  return candidates.map((candidate, index) => normalizeRowCandidate(candidate, `${idPrefix}-${startIndex + index}`));
}

export function parseRawComparisonText(input: string, warnings: string[] = []): RowCandidate[] {
  const lines = input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  if (!delimiter) {
    warnings.push('텍스트 표 구분자를 찾지 못했습니다. 탭/파이프/쉼표 구분 표를 기대합니다.');
    return [];
  }

  const records = lines.map((line) => splitDelimitedLine(line, delimiter));
  const headerIndex = records.findIndex((record) => detectHeaderMap(record).size >= 2);
  if (headerIndex === -1) {
    warnings.push('신구조문 대비표 헤더를 찾지 못했습니다.');
    return [];
  }

  const headerMap = detectHeaderMap(records[headerIndex]);
  const body = records.slice(headerIndex + 1).filter((record) => record.some((cell) => cleanCell(cell)));

  return body.map((record, sourceIndex) => ({
    sourceIndex,
    values: valuesFromRecord(record, headerMap),
  }));
}

export function normalizeHeaderLabel(label: string): CanonicalColumn | undefined {
  const compact = cleanCell(label).replace(/[\s·ㆍ_\-()\[\]<>:：]/g, '').toLowerCase();
  const entries = Object.entries(HEADER_ALIASES) as Array<[CanonicalColumn, RegExp[]]>;
  return entries.find(([, patterns]) => patterns.some((pattern) => pattern.test(compact)))?.[0];
}

function normalizeRawRowCandidates(rows: RawComparisonRow[], warnings: string[]): RowCandidate[] {
  if (rows.length === 0) return [];

  if (Array.isArray(rows[0])) {
    const arrayRows = rows as unknown[][];
    const headerIndex = arrayRows.findIndex((row) => detectHeaderMap(row.map(String)).size >= 2);
    if (headerIndex === -1) {
      warnings.push('배열 행에서 신구조문 대비표 헤더를 찾지 못했습니다.');
      return [];
    }
    const headerMap = detectHeaderMap(arrayRows[headerIndex].map(String));
    return arrayRows.slice(headerIndex + 1).map((record, sourceIndex) => ({
      sourceIndex,
      values: valuesFromRecord(record.map((cell) => String(cell ?? '')), headerMap),
    }));
  }

  return (rows as Record<string, unknown>[]).map((row, sourceIndex) => {
    const values = {} as Record<CanonicalColumn, string | undefined>;
    for (const [key, value] of Object.entries(row)) {
      const column = normalizeHeaderLabel(key);
      if (column) values[column] = stringify(value);
    }
    return { sourceIndex, values };
  });
}

function normalizeRowCandidate(candidate: RowCandidate, id: string): ParsedComparisonRow {
  const rowWarnings: string[] = [];
  let article = extractArticle(candidate.values.article) ?? extractArticle(candidate.values.oldText) ?? extractArticle(candidate.values.newText);
  let oldText = cleanClauseText(candidate.values.oldText);
  let newText = cleanClauseText(candidate.values.newText);
  const reasonParts = [candidate.values.reason, candidate.values.note].map(cleanClauseText).filter(Boolean);

  if (CREATED_MARKER.test(oldText)) {
    oldText = '';
    if (!reasonParts.some((part) => /신설/.test(part))) reasonParts.unshift('신설');
  }
  if (DELETED_MARKER.test(newText)) {
    newText = '';
    if (!reasonParts.some((part) => /삭제/.test(part))) reasonParts.unshift('삭제');
  }
  if (OMITTED_MARKER.test(oldText)) oldText = '';
  if (OMITTED_MARKER.test(newText)) newText = '';

  const reason = reasonParts.length ? reasonParts.join(' / ') : undefined;
  if (!article) rowWarnings.push('조문 제목을 찾지 못했습니다.');
  if (!oldText && !newText) rowWarnings.push('구 조문과 신 조문 본문이 모두 비어 있습니다.');
  if (candidate.values.reason && !reason) rowWarnings.push('개정사유 열은 있으나 내용이 비어 있습니다.');

  return {
    id,
    article,
    oldText,
    newText,
    reason,
    page: parsePage(candidate.values.page),
    confidence: confidenceForRow(article, oldText, newText, rowWarnings),
    warnings: rowWarnings,
  };
}

function detectDelimiter(lines: string[]): string | undefined {
  const candidates = ['\t', '|', ','];
  return candidates
    .map((delimiter) => ({ delimiter, score: lines.filter((line) => splitDelimitedLine(line, delimiter).length >= 2).length }))
    .sort((a, b) => b.score - a.score)[0]?.score
    ? candidates.map((delimiter) => ({ delimiter, score: lines.filter((line) => splitDelimitedLine(line, delimiter).length >= 2).length })).sort((a, b) => b.score - a.score)[0].delimiter
    : undefined;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  return line.split(delimiter).map((cell) => cell.trim());
}

function detectHeaderMap(headers: string[]): Map<number, CanonicalColumn> {
  const map = new Map<number, CanonicalColumn>();
  headers.forEach((header, index) => {
    const column = normalizeHeaderLabel(header);
    if (column && ![...map.values()].includes(column)) map.set(index, column);
  });
  return map;
}

function valuesFromRecord(record: string[], headerMap: Map<number, CanonicalColumn>): Record<CanonicalColumn, string | undefined> {
  const values = {} as Record<CanonicalColumn, string | undefined>;
  for (const [index, column] of headerMap.entries()) values[column] = cleanCell(record[index] ?? '');
  return values;
}

function cleanCell(input: string): string {
  return input.replace(/\u00a0/g, ' ').replace(/\\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function cleanClauseText(input: string | undefined): string {
  return cleanCell(input ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !isRepeatedComparisonHeader(line) && !isHwpControlArtifact(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function isRepeatedComparisonHeader(line: string): boolean {
  const compact = line.replace(/[\s·ㆍ.()\[\]<>:：]/g, '');
  return /^(현행|개정안|개정후|비고|현행개정안비고|현행개정비고)$/.test(compact);
}

function isHwpControlArtifact(line: string): boolean {
  return /^(?:[\u0000-\u001f\uf000-\uf8ff]|[捤獥汤捯湰灧桤漠杳氠瑢])+$/.test(line);
}

function extractArticle(input: string | undefined): string | undefined {
  const text = cleanCell(input ?? '');
  const matched = text.match(ARTICLE_PATTERN)?.[1]?.replace(/\s+/g, ' ').trim();
  return matched || undefined;
}

function parsePage(input: string | undefined): number | undefined {
  const parsed = Number(cleanCell(input ?? '').match(/\d+/)?.[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function confidenceForRow(article: string | undefined, oldText: string, newText: string, warnings: string[]): number {
  let confidence = 0.95;
  if (!article) confidence -= 0.15;
  if (!oldText || !newText) confidence -= 0.05;
  confidence -= warnings.length * 0.05;
  return Math.max(0.5, Number(confidence.toFixed(2)));
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function isRowCandidateArray(input: RowCandidate[] | RawComparisonRow[]): input is RowCandidate[] {
  return input.every((row) => typeof row === 'object' && row !== null && 'values' in row && 'sourceIndex' in row);
}
