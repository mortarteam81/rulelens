import { NextResponse } from 'next/server';
import { createConfiguredKoreanLawEvidenceRetriever } from '@/lib/mcp/korean-law-client';

export async function POST() {
  const retriever = createConfiguredKoreanLawEvidenceRetriever();
  const sample = await retriever.searchEvidence({ keywords: ['사립학교법'], article: '제3조 (구성)', text: '기금운용심의회 외부 전문가는 2명 이상 포함하여야 한다.' });
  return NextResponse.json({
    status: process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY ? 'live-cli-configured' : 'adapter-ready-missing-api-key',
    tools: [
      { name: 'search_law', use: '법령명 검색 → mst/lawId 확보', state: 'live via korean-law CLI when LAW_OC/KOREAN_LAW_API_KEY is set' },
      { name: 'get_law_text', use: 'mst/lawId + 조문번호 기준 공식 조문 조회', state: 'live via korean-law CLI when LAW_OC/KOREAN_LAW_API_KEY is set' },
      { name: 'kordoc MCP', use: 'HWP/HWPX/PDF 문서 파싱, 표 추출, 문서 비교', state: 'adapter-ready; optional local CLI/MCP' },
    ],
    evidenceCount: sample.length,
    sampleStatus: sample.length ? 'citation evidence available' : 'no citation evidence; remains safe fallback',
    message: 'Korean Law evidence는 실제 도구명(search_law/get_law_text) 기준으로 연결됩니다. API 키가 없거나 citation이 없으면 근거를 확정 표시하지 않습니다.',
  });
}
