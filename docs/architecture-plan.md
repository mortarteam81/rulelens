# 규정 분석 대시보드 아키텍처 계획

## 설계 원칙
- 공개 규정시스템은 기준 데이터 소스로 사용한다.
- 앞으로 작성할 개정안은 HWP/PDF 업로드로 처리한다.
- 모든 입력은 공통 `ParsedComparisonTable`로 정규화한 뒤 분석한다.
- 파싱/정규화는 결정론적 코드로 처리한다.
- AI는 요약, 분류, 위험도 보조, 질문/검토의견 초안 생성에만 사용한다.
- 법령 근거는 Korean Law MCP citation 기반으로만 확정 표시한다.

## 전체 파이프라인
```text
Input Source
→ fetch/parse source
→ normalize comparison table
→ detect changes
→ rule-based risk pre-score
→ AI clause analysis
→ Korean Law MCP evidence retrieval
→ Gordon MCP practical reasoning
→ validation
→ dashboard rendering
```

## 입력 소스 추상화

### `SourceInput`
```ts
type SourceInput =
  | { kind: 'sungshin-url'; url: string }
  | { kind: 'upload'; fileName: string; mimeType: string; bytes: ArrayBuffer }
  | { kind: 'manual'; regulationName: string; rows: ParsedComparisonRow[] };
```

### `ParsedComparisonTable`
```ts
type ParsedComparisonTable = {
  regulationName?: string;
  sourceKind: 'sungshin' | 'upload' | 'manual';
  sourceFormat: 'html' | 'hwp' | 'hwpx' | 'pdf' | 'text' | 'unknown';
  currentHistory?: string;
  previousHistory?: string;
  rows: ParsedComparisonRow[];
  warnings: string[];
};
```

### `ParsedComparisonRow`
```ts
type ParsedComparisonRow = {
  id: string;
  article?: string;
  oldText: string;
  newText: string;
  reason?: string;
  page?: number;
  confidence: number;
  warnings: string[];
};
```

## 모듈 구조

```text
lib/sources/types.ts
lib/sources/sungshin-rules-client.ts
lib/sources/sungshin-rule-parser.ts

lib/parsers/types.ts
lib/parsers/index.ts
lib/parsers/hwp.ts
lib/parsers/hwpx.ts
lib/parsers/pdf.ts
lib/parsers/normalize.ts

lib/pipeline.ts
lib/schemas.ts
lib/validators/analysis-validator.ts

lib/mcp/korean-law-client.ts
lib/mcp/gordon-client.ts
```

## 성신 규정관리시스템 Connector

### 활용 가능 공개 엔드포인트
- `/service/revision/revisionlist.do`
- `/service/revision/revisionView.do?historySeq=...`
- `/service/law/lawView.do?seq=...&historySeq=0&gubun=cur&tree=part`
- `/service/law/lawChangeList.do?seq=...&historySeq=...`
- `/download.do?gubun=101&seq=...` HWP
- `/download.do?gubun=106&seq=...` PDF

### 주의
- 관리자서비스 `/process/*`는 사용하지 않는다.
- 요청 간격 제한과 캐시를 둔다.
- 페이지 구조 변경에 대비해 parser warnings를 남긴다.

## HWP/PDF Parser 전략
- HWPX: ZIP + XML 파싱 우선 (`jszip`, `fast-xml-parser`)
- Legacy HWP: Python sidecar 또는 `hwp5txt` adapter
- PDF: PyMuPDF/pdfplumber adapter 검토
- OCR은 후순위

## 보안/배포
- 공개 배포 전 인증 필수
- 원본 파일 private storage
- 원본 자동 삭제 옵션
- 원문 전문 로그 금지
- MCP 호출 전 민감정보 최소화
- Vercel + Supabase MVP 가능하나 내부자료 민감도에 따라 private VPS 검토

## 1차 구현 패치
1. source/parser 타입 추가
2. 성신 `lawChangeList` HTML parser 추가
3. `/api/analyze`가 URL 또는 파일 입력을 받도록 개편
4. UI에 URL 입력 추가
5. parser warnings/confidence 표시
6. 빌드 검증
