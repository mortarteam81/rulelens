import type { ClauseAnalysis } from '@/lib/types';

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
  callTool(name: 'law_search' | 'law_get_article' | string, args: Record<string, unknown>): Promise<unknown>;
}

export class KoreanLawMcpEvidenceRetriever implements LawEvidenceRetriever {
  constructor(private readonly client?: KoreanLawMcpToolClient) {}

  async searchEvidence(query: LegalEvidenceQuery): Promise<LawEvidence[]> {
    if (!this.client) return [];
    const response = await this.client.callTool('law_search', {
      query: query.keywords.join(' '),
      article: query.article,
      text: query.text,
    });
    return normalizeEvidenceResponse(response, 'korean-law-mcp');
  }

  async getArticle(lawName: string, articleNumber: string): Promise<LawEvidence | null> {
    if (!this.client) return null;
    const response = await this.client.callTool('law_get_article', { lawName, articleNumber });
    return normalizeEvidenceResponse(response, 'korean-law-mcp')[0] || null;
  }
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

function normalizeEvidenceResponse(response: unknown, source: LawEvidenceSource): LawEvidence[] {
  const items = Array.isArray(response) ? response : Array.isArray((response as { results?: unknown[] })?.results) ? (response as { results: unknown[] }).results : [];
  return items.map((item, index) => sanitizeEvidence({ ...(item as Record<string, unknown>), source } as LawEvidence, `${source}-${index}`)).filter(Boolean) as LawEvidence[];
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

function normalizeTerm(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
