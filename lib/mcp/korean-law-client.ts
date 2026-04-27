import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ClauseAnalysis } from '@/lib/types';

const execFileAsync = promisify(execFile);

export type LegalCheckStatus = '근거 확인' | '추가 확인 필요' | '충돌 가능성 있음' | '근거 미확인';

export type LawEvidenceSource = 'korean-law-mcp' | 'mock' | 'manual';

export type LawEvidence = {
  id: string;
  source: LawEvidenceSource;
  lawName: string;
  articleNumber: string;
  articleTitle?: string;
  text: string;
  citation: string;
  url?: string;
  retrievedAt?: string;
  confidence?: number;
};

export type LegalEvidenceQuery = {
  keywords: string[];
  article?: string;
  text?: string;
};

export type LegalCheckResult = {
  status: LegalCheckStatus;
  evidence: LawEvidence[];
  missingEvidence: LegalEvidenceQuery[];
  warnings: string[];
  checkedAt: string;
};

export interface LawEvidenceRetriever {
  searchEvidence(query: LegalEvidenceQuery): Promise<LawEvidence[]>;
  getArticle?(lawName: string, articleNumber: string): Promise<LawEvidence | null>;
}

export interface KoreanLawMcpToolClient {
  callTool(name: 'law_search' | 'law_get_article' | 'search_law' | 'get_law_text' | string, args: Record<string, unknown>): Promise<unknown>;
}

export type KoreanLawCliToolClientOptions = {
  apiKey?: string;
  command?: string;
  timeoutMs?: number;
  maxBuffer?: number;
};

export class KoreanLawCliToolClient implements KoreanLawMcpToolClient {
  private readonly apiKey?: string;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly maxBuffer: number;

  constructor(options: KoreanLawCliToolClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY;
    this.command = options.command || path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'korean-law.cmd' : 'korean-law');
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBuffer = options.maxBuffer ?? 8 * 1024 * 1024;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.apiKey) {
      return { isError: true, error: 'missing-api-key', warnings: ['LAW_OC 또는 KOREAN_LAW_API_KEY 환경변수가 없어 Korean Law CLI를 호출하지 않았습니다.'] };
    }
    const cliName = name === 'law_search' ? 'search_law' : name === 'law_get_article' ? 'get_law_text' : name;
    const normalizedArgs = normalizeCliArgs(cliName, args);
    const jsonInput = JSON.stringify({ ...normalizedArgs, apiKey: this.apiKey });
    try {
      const { stdout, stderr } = await execFileAsync(this.command, [cliName, '--json-input', jsonInput], {
        timeout: this.timeoutMs,
        maxBuffer: this.maxBuffer,
        encoding: 'utf8',
      });
      return parseCliOutput(stdout, stderr);
    } catch (error) {
      return { isError: true, error: messageOf(error), stdout: (error as { stdout?: string }).stdout, stderr: (error as { stderr?: string }).stderr };
    }
  }
}

export class KoreanLawMcpEvidenceRetriever implements LawEvidenceRetriever {
  constructor(private readonly client?: KoreanLawMcpToolClient) {}

  async searchEvidence(query: LegalEvidenceQuery): Promise<LawEvidence[]> {
    if (!this.client) return [];
    const targets = inferLawTargets(query);
    const evidence: LawEvidence[] = [];

    for (const target of targets) {
      const searchResponse = await this.client.callTool('search_law', { query: target.lawName, display: 5 });
      const laws = normalizeLawSearchResponse(searchResponse);
      const law = chooseBestLaw(laws, target.lawName);
      if (!law) continue;

      const articleNumber = target.articleNumber || inferArticleNumber(query, target.lawName);
      if (!articleNumber) continue;

      const articleResponse = await this.client.callTool('get_law_text', {
        mst: law.mst,
        lawId: law.lawId,
        jo: articleNumber,
      });
      evidence.push(...normalizeEvidenceResponse(articleResponse, 'korean-law-mcp', { lawName: law.lawName || target.lawName, articleNumber }));
    }

    if (evidence.length) return uniqueEvidence(evidence);

    const fallbackResponse = await this.client.callTool('law_search', {
      query: query.keywords.join(' '),
      article: query.article,
      text: query.text,
    });
    return normalizeEvidenceResponse(fallbackResponse, 'korean-law-mcp');
  }

  async getArticle(lawName: string, articleNumber: string): Promise<LawEvidence | null> {
    if (!this.client) return null;
    const searchResponse = await this.client.callTool('search_law', { query: lawName, display: 5 });
    const law = chooseBestLaw(normalizeLawSearchResponse(searchResponse), lawName);
    if (!law) return null;
    const response = await this.client.callTool('get_law_text', { mst: law.mst, lawId: law.lawId, jo: articleNumber });
    return normalizeEvidenceResponse(response, 'korean-law-mcp', { lawName: law.lawName || lawName, articleNumber })[0] || null;
  }
}

export function createConfiguredKoreanLawEvidenceRetriever(): LawEvidenceRetriever {
  if (process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY) return new KoreanLawMcpEvidenceRetriever(new KoreanLawCliToolClient());
  return new MockLawEvidenceRetriever();
}

export class MockLawEvidenceRetriever implements LawEvidenceRetriever {
  private readonly evidence: LawEvidence[];

  constructor(evidence: LawEvidence[] = []) {
    this.evidence = evidence.map((item, index) => sanitizeEvidence(item, `mock-${index}`)).filter(Boolean) as LawEvidence[];
  }

  async searchEvidence(query: LegalEvidenceQuery): Promise<LawEvidence[]> {
    const terms = query.keywords.map(normalizeTerm).filter(Boolean);
    if (!terms.length) return [];
    return this.evidence.filter((item) => {
      const haystack = normalizeTerm(`${item.lawName} ${item.articleNumber} ${item.articleTitle || ''} ${item.text} ${item.citation}`);
      return terms.some((term) => haystack.includes(term));
    });
  }

  async getArticle(lawName: string, articleNumber: string): Promise<LawEvidence | null> {
    const law = normalizeTerm(lawName);
    const article = normalizeTerm(articleNumber);
    return this.evidence.find((item) => normalizeTerm(item.lawName) === law && normalizeTerm(item.articleNumber) === article) || null;
  }
}

export async function checkLegalCompliance(input: {
  clause: Pick<ClauseAnalysis, 'article' | 'oldText' | 'newText' | 'lawKeywords'>;
  retriever?: LawEvidenceRetriever;
  checkedAt?: string;
}): Promise<LegalCheckResult> {
  const checkedAt = input.checkedAt || new Date().toISOString();
  const retriever = input.retriever || new MockLawEvidenceRetriever();
  const keywords = normalizeKeywords(input.clause.lawKeywords);
  const query: LegalEvidenceQuery = {
    keywords,
    article: input.clause.article,
    text: input.clause.newText || input.clause.oldText,
  };

  if (!keywords.length) {
    return { status: '근거 미확인', evidence: [], missingEvidence: [query], warnings: ['검색 키워드가 없어 법령 근거를 확인하지 못했습니다.'], checkedAt };
  }

  const evidence = uniqueEvidence((await retriever.searchEvidence(query)).map((item, index) => sanitizeEvidence(item, `evidence-${index}`)).filter(Boolean) as LawEvidence[]);
  const warnings: string[] = [];

  if (!evidence.length) {
    return { status: '근거 미확인', evidence: [], missingEvidence: [query], warnings: ['인용 가능한 법령 근거가 없습니다. citation 없는 항목은 표시하지 않습니다.'], checkedAt };
  }

  const clauseText = `${input.clause.oldText} ${input.clause.newText}`;
  const hasPossibleConflict = evidence.some((item) => hasConflictSignal(clauseText, item.text));
  if (hasPossibleConflict) warnings.push('조문 문안과 법령 근거 사이에 상반되는 표현이 있어 원문 대조가 필요합니다.');

  const needsMore = keywords.some((keyword) => /관련 상위규정|위임 근거|위원회|심의|자료 제출/.test(keyword)) && evidence.length < Math.min(2, keywords.length);
  const status: LegalCheckStatus = hasPossibleConflict ? '충돌 가능성 있음' : needsMore ? '추가 확인 필요' : '근거 확인';
  const missingEvidence = status === '근거 확인' || status === '충돌 가능성 있음' ? [] : [query];

  return { status, evidence, missingEvidence, warnings, checkedAt };
}

type LawSearchHit = { lawName?: string; mst?: string; lawId?: string };

type EvidenceDefaults = { lawName?: string; articleNumber?: string };

function normalizeEvidenceResponse(response: unknown, source: LawEvidenceSource, defaults: EvidenceDefaults = {}): LawEvidence[] {
  const rawItems = extractItems(response);
  const items = rawItems.length ? rawItems : typeof response === 'string' ? [{ text: response }] : [];
  return items.map((item, index) => normalizeEvidenceItem(item as Record<string, unknown>, source, defaults, `${source}-${index}`)).filter(Boolean) as LawEvidence[];
}

function normalizeEvidenceItem(item: Record<string, unknown>, source: LawEvidenceSource, defaults: EvidenceDefaults, fallbackId: string): LawEvidence | null {
  const text = stringField(item, ['text', 'content', 'articleText', '조문내용', '본문', '내용']) || extractTextFromContent(item.content);
  const lawName = stringField(item, ['lawName', '법령명', 'lawTitle']) || defaults.lawName || inferLawNameFromText(text);
  const articleNumber = stringField(item, ['articleNumber', '조문번호', 'articleNo', 'jo']) || defaults.articleNumber || inferArticleFromText(text);
  const articleTitle = stringField(item, ['articleTitle', '조문제목', 'title']);
  const url = stringField(item, ['url', 'link', 'href']);
  const citation = stringField(item, ['citation', '인용', 'cite']) || buildCitation(lawName, articleNumber, articleTitle, url);
  return sanitizeEvidence({ ...(item as unknown as LawEvidence), source, lawName: lawName || '', articleNumber: articleNumber || '', articleTitle, text: text || '', citation, url }, fallbackId);
}

function normalizeLawSearchResponse(response: unknown): LawSearchHit[] {
  return extractItems(response).map((item) => {
    const record = item as Record<string, unknown>;
    return {
      lawName: stringField(record, ['lawName', '법령명한글', '법령명', 'name', 'title']),
      mst: stringField(record, ['mst', 'MST', '법령일련번호']),
      lawId: stringField(record, ['lawId', 'LAW_ID', '법령ID']),
    };
  }).filter((item) => item.lawName || item.mst || item.lawId);
}

function extractItems(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  const record = response as Record<string, unknown> | undefined;
  if (!record) return [];
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.laws)) return record.laws;
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray((record.structuredContent as Record<string, unknown> | undefined)?.results)) return (record.structuredContent as { results: unknown[] }).results;
  const contentText = extractTextFromContent(record.content);
  if (contentText) return [{ text: contentText }];
  if (typeof record.text === 'string' || typeof record.lawName === 'string' || typeof record['법령명'] === 'string') return [record];
  return [];
}

function inferLawTargets(query: LegalEvidenceQuery): { lawName: string; articleNumber?: string }[] {
  const text = `${query.article ?? ''} ${query.text ?? ''} ${query.keywords.join(' ')}`;
  const targets = new Map<string, { lawName: string; articleNumber?: string }>();
  for (const keyword of query.keywords) {
    if (/법|령|규정/u.test(keyword) && !/위원회|심의|자료 제출|관련 상위규정|위임 근거/u.test(keyword)) targets.set(keyword, { lawName: keyword });
  }
  if (/사립학교법|기금운용심의회|외부\s*전문가/u.test(text)) targets.set('사립학교법', { lawName: '사립학교법', articleNumber: '제32조의3' });
  return [...targets.values()];
}

function inferArticleNumber(query: LegalEvidenceQuery, lawName: string): string | undefined {
  const text = `${query.article ?? ''} ${query.text ?? ''}`;
  const explicit = text.match(/제\s*\d+\s*조(?:의\s*\d+)?/u)?.[0];
  if (explicit) return explicit.replace(/\s+/g, '');
  if (lawName === '사립학교법' && /기금운용심의회|외부\s*전문가/u.test(text)) return '제32조의3';
  return undefined;
}

function chooseBestLaw(laws: LawSearchHit[], lawName: string): LawSearchHit | undefined {
  const normalized = normalizeTerm(lawName);
  return laws.find((law) => normalizeTerm(law.lawName || '') === normalized) || laws.find((law) => normalizeTerm(law.lawName || '').includes(normalized)) || laws[0];
}

function normalizeCliArgs(toolName: string, args: Record<string, unknown>) {
  if (toolName === 'search_law') return { query: args.query, display: args.display ?? 5 };
  if (toolName === 'get_law_text') return { mst: args.mst, lawId: args.lawId, jo: args.jo ?? args.articleNumber ?? args.article };
  return args;
}

function parseCliOutput(stdout: string, stderr: string): unknown {
  const text = stdout.trim();
  if (!text) return { isError: true, stderr };
  try { return JSON.parse(text); } catch { return { text, stderr }; }
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function extractTextFromContent(content: unknown): string | undefined {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return undefined;
  return content.map((item) => typeof item?.text === 'string' ? item.text : '').filter(Boolean).join('\n').trim() || undefined;
}

function inferLawNameFromText(text?: string): string | undefined {
  return text?.match(/([가-힣A-Za-z·]+법)\s*제\s*\d+\s*조/u)?.[1];
}

function inferArticleFromText(text?: string): string | undefined {
  return text?.match(/제\s*\d+\s*조(?:의\s*\d+)?/u)?.[0]?.replace(/\s+/g, '');
}

function buildCitation(lawName?: string, articleNumber?: string, articleTitle?: string, url?: string): string {
  const base = [lawName, articleNumber].filter(Boolean).join(' ');
  if (!base) return '';
  return `${base}${articleTitle ? `(${articleTitle})` : ''}${url ? ` · ${url}` : ''}`;
}

function sanitizeEvidence(item: LawEvidence, fallbackId: string): LawEvidence | null {
  const citation = typeof item.citation === 'string' ? item.citation.trim() : '';
  const lawName = typeof item.lawName === 'string' ? item.lawName.trim() : '';
  const articleNumber = typeof item.articleNumber === 'string' ? item.articleNumber.trim() : '';
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!citation || !lawName || !articleNumber || !text) return null;
  return {
    id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : fallbackId,
    source: item.source || 'manual',
    lawName,
    articleNumber,
    articleTitle: typeof item.articleTitle === 'string' ? item.articleTitle.trim() : undefined,
    text,
    citation,
    url: typeof item.url === 'string' ? item.url.trim() : undefined,
    retrievedAt: typeof item.retrievedAt === 'string' ? item.retrievedAt : undefined,
    confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
  };
}

function normalizeKeywords(keywords: string[]) {
  return [...new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean).filter((keyword) => !/^관련 상위규정$|^위임 근거$/.test(keyword)))];
}

function uniqueEvidence(evidence: LawEvidence[]) {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.citation}|${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasConflictSignal(clauseText: string, evidenceText: string) {
  const clause = normalizeTerm(clauseText);
  const evidence = normalizeTerm(evidenceText);
  return (/반환하지아니|반환불가|환불하지/.test(clause) && /반환하여야|반환해야|반환한다/.test(evidence)) ||
    (/허용하지아니|금지/.test(clause) && /허용할수있|허용한다/.test(evidence));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
