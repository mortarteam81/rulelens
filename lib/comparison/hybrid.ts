import type { ParsedComparisonRow, ParsedComparisonTable } from '@/lib/parsers/types';

export type HybridChangeKind = '신설' | '삭제' | '변경';

type IndexedRow = {
  row: ParsedComparisonRow;
  articleKey?: string;
  titleKey?: string;
  textKey: string;
};

export function buildHybridComparisonTable(
  currentSource: ParsedComparisonTable,
  proposedSource: ParsedComparisonTable,
): ParsedComparisonTable {
  const warnings: string[] = [
    ...prefixWarnings('성신 기준', currentSource.warnings),
    ...prefixWarnings('업로드 개정안', proposedSource.warnings),
  ];

  const baselineRows = currentSource.rows
    .map((row) => toBaselineRow(row))
    .filter((row) => row.newText || row.article);
  const proposedRows = proposedSource.rows
    .map((row) => toProposedRow(row))
    .filter((row) => row.newText || row.oldText || row.article);

  if (baselineRows.length === 0) warnings.push('성신 URL에서 기준 현행 조문을 만들 수 없습니다.');
  if (proposedRows.length === 0) warnings.push('업로드 파일에서 개정안 조문을 만들 수 없습니다.');

  if (proposedRows.length === 0) {
    return {
      regulationName: currentSource.regulationName ?? proposedSource.regulationName,
      sourceKind: 'hybrid',
      sourceFormat: proposedSource.sourceFormat,
      previousHistory: currentSource.currentHistory,
      currentHistory: '업로드 개정안',
      rows: [],
      warnings,
    };
  }

  const baseline = baselineRows.map(indexRow);
  const proposed = proposedRows.map(indexRow);
  const matchedBaseline = new Set<number>();
  const rows: ParsedComparisonRow[] = [];

  proposed.forEach((candidate, proposedIndex) => {
    const match = findBestBaselineMatch(candidate, baseline, matchedBaseline);
    const proposedText = candidate.row.newText;

    if (!match) {
      if (candidate.row.oldText?.trim() && proposedText.trim()) {
        rows.push(makeHybridRow(rows.length, '변경', undefined, candidate.row, proposedIndex, undefined, [
          '성신 기준 조문에서 같은 조문번호/제목을 찾지 못했습니다. 업로드 파일의 현행/개정안 대비표 기준 변경으로 분류했습니다.',
        ]));
      } else {
        rows.push(makeHybridRow(rows.length, '신설', undefined, candidate.row, proposedIndex, undefined, [
          '성신 기준 조문에서 같은 조문번호/제목을 찾지 못했습니다.',
        ]));
      }
      return;
    }

    matchedBaseline.add(match.index);
    const baselineText = match.indexed.row.newText;

    if (!proposedText.trim()) {
      rows.push(makeHybridRow(rows.length, '삭제', match.indexed.row, candidate.row, proposedIndex, match.score, [
        '업로드 개정안의 신 조문이 비어 있어 삭제로 분류했습니다.',
      ]));
      return;
    }

    if (normalizeComparableText(baselineText) === normalizeComparableText(proposedText)) return;

    rows.push(makeHybridRow(rows.length, '변경', match.indexed.row, candidate.row, proposedIndex, match.score));
  });

  if (shouldInferMissingBaselineAsDeletion(baselineRows, proposedRows)) {
    baseline.forEach((indexed, index) => {
      if (matchedBaseline.has(index)) return;
      rows.push(makeHybridRow(rows.length, '삭제', indexed.row, undefined, undefined, undefined, [
        '업로드 개정안에서 대응 조문을 찾지 못해 삭제 가능성으로 분류했습니다.',
      ]));
    });
  } else if (baselineRows.length > matchedBaseline.size) {
    warnings.push('업로드 개정안이 일부 조문/별표만 포함한 것으로 보여, 성신 기준의 미매칭 조문을 삭제로 자동 분류하지 않았습니다.');
  }

  if (rows.length === 0 && baselineRows.length && proposedRows.length) {
    warnings.push('성신 기준 현행 조문과 업로드 개정안 사이에서 변경 조문을 찾지 못했습니다.');
  }

  return {
    regulationName: currentSource.regulationName ?? proposedSource.regulationName,
    sourceKind: 'hybrid',
    sourceFormat: proposedSource.sourceFormat,
    previousHistory: currentSource.currentHistory,
    currentHistory: '업로드 개정안',
    rows,
    warnings,
  };
}

function toBaselineRow(row: ParsedComparisonRow): ParsedComparisonRow {
  const text = row.newText || (row.reason === '삭제' ? '' : row.oldText);
  return {
    ...row,
    oldText: '',
    newText: text,
    warnings: row.newText ? row.warnings : [...row.warnings, '성신 대비표 행에 신 조문이 없어 기준 현행에서 제외될 수 있습니다.'],
  };
}

function toProposedRow(row: ParsedComparisonRow): ParsedComparisonRow {
  return {
    ...row,
    oldText: row.oldText,
    newText: row.newText,
  };
}

function indexRow(row: ParsedComparisonRow): IndexedRow {
  return {
    row,
    articleKey: articleKey(row.article) ?? articleKey(row.oldText) ?? articleKey(row.newText),
    titleKey: titleKey(row.article) ?? titleKey(row.oldText) ?? titleKey(row.newText),
    textKey: normalizeComparableText(`${row.article ?? ''}\n${row.oldText}\n${row.newText}`).slice(0, 300),
  };
}

function findBestBaselineMatch(candidate: IndexedRow, baseline: IndexedRow[], used: Set<number>) {
  let best: { index: number; indexed: IndexedRow; score: number } | undefined;

  baseline.forEach((indexed, index) => {
    if (used.has(index)) return;
    const score = matchScore(candidate, indexed);
    if (score < 0.42) return;
    if (!best || score > best.score) best = { index, indexed, score };
  });

  return best;
}

function matchScore(a: IndexedRow, b: IndexedRow): number {
  if (a.articleKey && b.articleKey && a.articleKey === b.articleKey) return 0.96;
  if (a.titleKey && b.titleKey && a.titleKey === b.titleKey) return 0.82;
  const overlap = tokenOverlap(a.textKey, b.textKey);
  return overlap >= 0.35 ? Math.min(0.7, overlap) : 0;
}

function makeHybridRow(
  index: number,
  kind: HybridChangeKind,
  baseline?: ParsedComparisonRow,
  proposed?: ParsedComparisonRow,
  proposedIndex?: number,
  matchScore?: number,
  extraWarnings: string[] = [],
): ParsedComparisonRow {
  const article = proposed?.article ?? baseline?.article;
  const oldText = baseline?.newText || baseline?.oldText || (kind === '변경' ? proposed?.oldText : '') || '';
  const newText = proposed?.newText || '';
  const baseConfidence = kind === '신설' ? 0.72 : kind === '삭제' ? 0.68 : 0.8;
  const confidence = clamp(Math.min(baseConfidence, matchScore ?? baseConfidence, baseline?.confidence ?? 1, proposed?.confidence ?? 1));
  const warnings = [
    ...(baseline?.warnings ?? []).map((warning) => `성신 기준: ${warning}`),
    ...(proposed?.warnings ?? []).map((warning) => `업로드 개정안: ${warning}`),
    ...extraWarnings,
  ];

  if (kind !== '신설' && matchScore !== undefined && matchScore < 0.75) {
    warnings.push(`조문 매칭 신뢰도가 낮습니다(${matchScore.toFixed(2)}).`);
  }

  return {
    id: `hybrid-${index + 1}`,
    article,
    oldText,
    newText,
    reason: proposed?.reason ?? kind,
    page: proposed?.page,
    confidence,
    warnings,
  };
}

function shouldInferMissingBaselineAsDeletion(baselineRows: ParsedComparisonRow[], proposedRows: ParsedComparisonRow[]): boolean {
  if (baselineRows.length === 0 || proposedRows.length === 0) return false;
  if (proposedRows.length >= Math.max(3, Math.ceil(baselineRows.length * 0.6))) return true;
  const explicitDeletionRows = proposedRows.filter((row) => !row.newText?.trim() && row.oldText?.trim()).length;
  if (explicitDeletionRows > 0) return true;
  return false;
}

function articleKey(input?: string): string | undefined {
  const match = input?.match(/제\s*(\d+)\s*조(?:의\s*(\d+))?/u);
  if (!match) return undefined;
  return `제${Number(match[1])}조${match[2] ? `의${Number(match[2])}` : ''}`;
}

function titleKey(input?: string): string | undefined {
  if (!input) return undefined;
  const articleTitle = input.match(/제\s*\d+\s*조(?:의\s*\d+)?\s*\(([^)]+)\)/u)?.[1];
  const appendixTitle = input.match(/<\s*(별표[^>]+)>/u)?.[1];
  const title = articleTitle ?? appendixTitle;
  return title ? normalizeComparableText(title) : undefined;
}

function normalizeComparableText(input: string): string {
  return input.replace(/\s+/g, '').replace(/[「」『』\[\]()（）.,，。ㆍ․·･]/g, '').toLowerCase();
}

function tokenOverlap(a: string, b: string): number {
  const aTokens = toTokens(a);
  const bTokens = toTokens(b);
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  for (const token of aTokens) if (bTokens.has(token)) intersection += 1;
  return intersection / Math.max(aTokens.size, bTokens.size);
}

function toTokens(input: string): Set<string> {
  const tokens = new Set<string>();
  for (let i = 0; i < input.length - 1; i += 2) tokens.add(input.slice(i, i + 4));
  return tokens;
}

function prefixWarnings(prefix: string, warnings: string[]): string[] {
  return warnings.map((warning) => `${prefix}: ${warning}`);
}

function clamp(value: number): number {
  return Math.max(0.1, Math.min(1, Number(value.toFixed(2))));
}
