import type { ParsedComparisonRow, ParsedComparisonTable } from '@/lib/parsers/types';

export function parseSungshinLawChangeListHtml(html: string): ParsedComparisonTable {
  const warnings: string[] = [];
  const regulationName = extractRegulationName(html);
  const previousHistory = matchText(html, /이전\s*연혁\s*\(([^)]+)\)/);
  const currentHistory = matchText(html, /현재\s*연혁\s*\(([^)]+)\)/);
  const rows = extractComparisonRows(html);

  if (!regulationName) warnings.push('규정명을 찾지 못했습니다.');
  if (!previousHistory) warnings.push('이전 연혁 일자를 찾지 못했습니다.');
  if (!currentHistory) warnings.push('현재 연혁 일자를 찾지 못했습니다.');
  if (rows.length === 0) warnings.push('신구조문 대비표 행을 찾지 못했습니다. 페이지 구조 변경 가능성이 있습니다.');

  return {
    regulationName,
    sourceKind: 'sungshin',
    sourceFormat: 'html',
    currentHistory,
    previousHistory,
    rows,
    warnings,
  };
}

function extractComparisonRows(html: string): ParsedComparisonRow[] {
  const cells = extractBtxtCells(html);
  const rows: ParsedComparisonRow[] = [];

  for (let i = 0; i + 1 < cells.length; i += 2) {
    const oldCell = cells[i];
    const newCell = cells[i + 1];

    const oldArticle = cleanText(matchText(oldCell, /<div[^>]*class="article"[^>]*>([\s\S]*?)<\/div>/i) ?? '');
    const newArticle = cleanText(matchText(newCell, /<div[^>]*class="article"[^>]*>([\s\S]*?)<\/div>/i) ?? '');
    const oldContentHtml = matchText(oldCell, /<div[^>]*class="changeContent"[^>]*>([\s\S]*?)<\/div>\s*$/i) ?? contentAfterArticle(oldCell);
    const newContentHtml = matchText(newCell, /<div[^>]*class="changeContent"[^>]*>([\s\S]*?)<\/div>\s*$/i) ?? contentAfterArticle(newCell);
    const oldText = cleanText(oldContentHtml);
    const newText = cleanText(newContentHtml);
    const article = normalizeArticle(newArticle || oldArticle);
    const rowWarnings: string[] = [];

    if (!article) rowWarnings.push('조문 제목을 찾지 못했습니다.');
    if (!oldText && !newText) rowWarnings.push('구 조문과 신 조문 본문이 모두 비어 있습니다.');

    rows.push({
      id: `sungshin-${rows.length + 1}`,
      article,
      oldText,
      newText,
      reason: inferReason(oldArticle, newArticle),
      confidence: rowWarnings.length ? 0.7 : 0.9,
      warnings: rowWarnings,
    });
  }

  return rows;
}

function extractBtxtCells(html: string): string[] {
  const cells: string[] = [];
  const cellStartPattern = /<td\b[^>]*class="btxt"[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = cellStartPattern.exec(html))) {
    const start = match.index;
    let cursor = start + match[0].length;
    let depth = 1;
    const tokenPattern = /<\/?td\b[^>]*>/gi;
    tokenPattern.lastIndex = cursor;

    let token: RegExpExecArray | null;
    while ((token = tokenPattern.exec(html))) {
      if (token[0].startsWith('</')) depth -= 1;
      else depth += 1;

      if (depth === 0) {
        cursor = token.index;
        cells.push(html.slice(start + match[0].length, cursor));
        cellStartPattern.lastIndex = tokenPattern.lastIndex;
        break;
      }
    }
  }

  return cells;
}

function extractRegulationName(html: string): string | undefined {
  const title = matchText(html, /<title>([\s\S]*?)<\/title>/i);
  const fromTitle = title?.split('|').map((part) => cleanText(part)).filter(Boolean).at(-1);
  if (fromTitle) return fromTitle;
  const heading = matchText(html, /<p[^>]*class="sbtit2"[^>]*>([\s\S]*?)<\/p>/i);
  return heading ? cleanText(heading) : undefined;
}

function inferReason(oldArticle: string, newArticle: string): string | undefined {
  if (/신설/.test(oldArticle)) return '신설';
  if (/삭제/.test(newArticle)) return '삭제';
  return undefined;
}

function normalizeArticle(article: string): string | undefined {
  const normalized = article.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function contentAfterArticle(cellHtml: string): string {
  return cellHtml.replace(/[\s\S]*?<div[^>]*class="article"[^>]*>[\s\S]*?<\/div>/i, '');
}

function matchText(input: string, pattern: RegExp): string | undefined {
  return input.match(pattern)?.[1];
}

function cleanText(input: string): string {
  return decodeHtmlEntities(
    input
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/div>\s*<div/gi, '\n<div')
      .replace(/<\/tr>\s*<tr/gi, '\n<tr')
      .replace(/<\/td>\s*<td[^>]*>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
