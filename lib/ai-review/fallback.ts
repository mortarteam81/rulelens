import type { ChangeType } from '../types';
import type { ParsedComparisonRow } from '../parsers/types';
import { ClauseAiReviewSchema, type ClauseAiReview, type LegalEvidenceStatus } from './schemas';

const DISCLAIMER = '이 검토는 실무 검토 보조용 초안이며 최종 법률자문 또는 확정 판단이 아닙니다. 법령 근거와 기관 내부 권한은 담당자가 원문과 최신 기준으로 재확인해야 합니다.';

export type ClauseReviewInput = {
  row: ParsedComparisonRow;
  changeType: ChangeType;
  riskScore: number;
  lawKeywords: string[];
};

export function buildDeterministicClauseReview(input: ClauseReviewInput): ClauseAiReview {
  const text = `${input.row.article ?? ''}\n${input.row.oldText}\n${input.row.newText}\n${input.row.reason ?? ''}`;
  const riskDrivers = detectRiskDrivers(text, input.changeType, input.row.confidence);
  const legalEvidenceStatus = determineLegalEvidenceStatus(input.lawKeywords);
  const review: ClauseAiReview = {
    schemaVersion: 'clause-review.v1',
    mode: 'deterministic_fallback',
    changeType: input.changeType,
    risk: {
      riskScore: clampScore(input.riskScore + (legalEvidenceStatus === 'missing_evidence' ? 5 : 0)),
      riskDrivers,
      practicalImpact: buildPracticalImpact(input.changeType, riskDrivers),
      reviewQuestions: buildReviewQuestions(input.changeType, legalEvidenceStatus),
      opinionDraft: buildOpinionDraft(input.row.reason ?? input.changeType, input.changeType, legalEvidenceStatus),
    },
    legalEvidence: {
      status: legalEvidenceStatus,
      citations: [],
      missingEvidenceReason: legalEvidenceStatus === 'missing_evidence'
        ? 'Korean Law MCP 또는 공식 법령 원문 citation이 아직 연결되지 않아 법령 근거를 확정 표시하지 않았습니다.'
        : '법령 키워드는 감지되었지만 citation 검증 전이므로 사람 검토가 필요합니다.',
      unsupportedCitationWarnings: input.lawKeywords.map((keyword) => `${keyword}: citation 미검증 상태이므로 법령 근거로 단정하지 않음`),
    },
    guardrails: {
      noFinalLegalAdvice: true,
      noUnsupportedLawCitations: true,
      humanReviewRequired: true,
      disclaimer: DISCLAIMER,
    },
  };

  return ClauseAiReviewSchema.parse(review);
}

function detectRiskDrivers(text: string, changeType: ChangeType, confidence?: number): string[] {
  const drivers = new Set<string>();
  if (changeType === '신설') drivers.add('새 의무·절차 신설 가능성');
  if (changeType === '삭제') drivers.add('기존 근거 삭제 또는 공백 가능성');
  if (/반드시|하여야|의무|제출|승인|심의|거쳐야/u.test(text)) drivers.add('의무·승인·심의 절차 문구 포함');
  if (/총장|위원회|부서장|책임|권한|위임/u.test(text)) drivers.add('권한 또는 책임 주체 변경 가능성');
  if (/기준|요건|자격|평가|정원|선발/u.test(text)) drivers.add('기준·요건·정원 관련 영향 가능성');
  if (confidence !== undefined && confidence < 0.75) drivers.add('파싱 또는 조문 매칭 신뢰도 낮음');
  if (!drivers.size) drivers.add('표현 정비 중심으로 보이나 조문 간 정합성 확인 필요');
  return [...drivers];
}

function determineLegalEvidenceStatus(keywords: string[]): LegalEvidenceStatus {
  const concreteLawKeyword = keywords.some((keyword) => /법|령|규정/u.test(keyword) && !/관련 상위규정|위임 근거/u.test(keyword));
  return concreteLawKeyword ? 'needs_human_review' : 'missing_evidence';
}

function buildPracticalImpact(changeType: ChangeType, drivers: string[]): string {
  if (changeType === '신설' || drivers.some((driver) => driver.includes('의무'))) {
    return '담당부서 업무량, 처리기한, 위원회 상정 여부, 시행 전 안내·서식 정비가 필요할 수 있습니다.';
  }
  if (changeType === '삭제') return '삭제 후에도 필요한 위임 근거·경과조치·다른 조항의 참조가 남아 있는지 확인해야 합니다.';
  if (drivers.some((driver) => driver.includes('권한'))) return '결재권자, 위원회 권한, 담당부서 책임 범위가 기존 규정 체계와 맞는지 확인해야 합니다.';
  return '직접 영향은 제한적일 수 있으나 용어 통일, 부칙, 별표·별지 참조 정합성 확인이 필요합니다.';
}

function buildReviewQuestions(changeType: ChangeType, status: LegalEvidenceStatus): string[] {
  const questions = [
    '상위 법령 또는 학내 상위 규정의 위임 근거가 확인되었는가?',
    '시행일, 경과조치, 기존 사건 적용 기준이 필요한가?',
    '관련 조항·별표·서식에서 같은 용어를 일관되게 사용하고 있는가?',
  ];
  if (changeType === '신설' || changeType === '절차 변경') questions.push('담당부서가 실제로 이행 가능한 절차·기한·증빙 체계를 갖추었는가?');
  if (changeType === '삭제') questions.push('삭제 조항을 참조하는 다른 조항이나 지침이 남아 있지 않은가?');
  if (status !== 'evidence_verified') questions.push('공식 법령 citation이 없으므로 Korean Law MCP 또는 국가법령정보센터 원문으로 근거를 확인했는가?');
  return questions;
}

function buildOpinionDraft(reason: string, changeType: ChangeType, status: LegalEvidenceStatus): string {
  const evidenceNote = status === 'evidence_verified'
    ? '확인된 citation 범위 내에서'
    : '법령 근거가 아직 확정 검증되지 않았으므로';
  return `본 개정안은 ${reason} 측면의 필요성이 있을 수 있습니다. 다만 ${evidenceNote} 상위 규정 근거, 조문 간 정합성, 실무 이행 가능성을 담당자가 추가 검토한 뒤 확정하는 것이 타당합니다. 본 문구는 검토의견 초안이며 최종 법률자문이 아닙니다.`;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
