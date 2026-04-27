# RuleLens IR Integration Phase 1

## 목적

RuleLens의 기존 규정 신구조문 분석 결과를 IR 시스템에서 재사용할 수 있도록 1차 통합 계층을 추가한다.

이번 단계의 핵심은 다음 세 가지다.

1. 운영 API에서 샘플 데이터 fallback을 기본 비활성화한다.
2. RuleLens 분석 결과 뒤에 IR 영향 분석 매핑 계층을 붙인다.
3. IR 연계 결과 JSON 구조를 스키마로 고정한다.

## 변경 사항

### 1. 운영 안전장치

`/api/analyze`에서 파싱 가능한 조문 행이 없으면 기본적으로 422 응답을 반환한다.

샘플 데이터 fallback은 아래 환경변수가 명시적으로 설정된 경우에만 허용한다.

```bash
RULELENS_ALLOW_SAMPLE_ROWS=true
```

운영/업무 검토 환경에서는 이 값을 설정하지 않는 것을 권장한다.

### 2. IR 매핑 계층 추가

새 디렉터리:

```text
lib/ir-mapping/
 ├─ types.ts
 ├─ indicator-dictionary.ts
 ├─ accreditation-dictionary.ts
 ├─ department-dictionary.ts
 ├─ scoring.ts
 └─ mapper.ts
```

`enrichWithIrMappings(result)` 함수는 기존 `AnalysisResult`를 받아 다음 정보를 추가한다.

- `schemaVersion`
- `irSummary`
- 조문별 `irMappings`
- 조문별 `accreditationMappings`
- 조문별 `departmentMappings`
- 조문별 `finalImpactScore`
- 조문별 `finalImpactLevel`
- 조문별 `followUpActions`

### 3. JSON Schema 추가

새 파일:

```text
schemas/ir-analysis-result.schema.json
```

IR 시스템 또는 향후 DB 저장 계층은 이 스키마를 기준으로 RuleLens API 응답 구조를 검증할 수 있다.

## API 응답 변화

기존:

```text
AnalysisResult
```

변경:

```text
IrExtendedAnalysisResult
```

기존 필드는 유지하면서 IR 확장 필드를 추가한다.

## 현재 매핑 방식

1차 구현은 키워드 기반 deterministic mapping이다.

- 대학정보공시/IR 지표 사전
- 4주기 대학기관평가인증 기준 사전
- 담당부서 사전

각 사전 항목의 키워드가 조문, 변경요약, 검토의견, 위험근거, 법령키워드에 포함되면 관련도 점수를 계산한다.

## 후속 단계

1. UI에 IR 영향 분석 섹션 추가
2. JSON/Markdown/CSV 산출물 다운로드 기능 추가
3. 실제 규정 개정안 fixture 10~20개로 매핑 정확도 검증
4. DB 저장 계층 추가
5. 별도 IR dashboard에서 `/api/analyze` 호출 구조 구성

## 주의사항

- 현재 IR 매핑은 키워드 기반이므로 누락과 오탐이 발생할 수 있다.
- 평가인증 기준 코드는 1차 내부 식별자이며, 실제 편람 기준코드와 대조해 보정해야 한다.
- 담당부서 매핑은 학교 조직 기준에 맞게 조정해야 한다.
