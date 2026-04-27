import { NextResponse } from 'next/server';
import { KoreanLawMcpEvidenceRetriever } from '@/lib/mcp/korean-law-client';

export async function POST() {
  const retriever = new KoreanLawMcpEvidenceRetriever();
  const sample = await retriever.searchEvidence({ keywords: ['고등교육법'], text: '연결 상태 확인' });
  return NextResponse.json({
    status: 'adapter-ready',
    tools: [
      { name: 'law_search', use: '관련 법령·상위규정 검색', state: 'future MCP tool; no live server assumed' },
      { name: 'law_get_article', use: '법령명/조문번호 기준 원문 조회', state: 'future MCP tool; no live server assumed' },
      { name: 'kordoc MCP', use: 'HWP/HWPX/PDF 문서 파싱, 표 추출, 문서 비교', state: 'adapter-ready; optional local CLI/MCP' },
    ],
    evidenceCount: sample.length,
    message: 'Korean Law MCP adapter boundary is safe by default. 서버가 없으면 citation 없는 결과를 만들지 않고 빈 evidence를 반환합니다.',
  });
}
