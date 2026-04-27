import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const schemaPath = new URL('../lib/ai-review/schemas.ts', import.meta.url);

try {
  await fs.access(schemaPath);
} catch {
  console.log('↷ Wave 3 AI/MCP contract skipped (lib/ai-review/schemas.ts not present yet)');
  process.exit(0);
}

const schemaSource = await fs.readFile(schemaPath, 'utf8');
for (const requiredText of [
  'deterministic_fallback',
  'ai_assisted',
  'evidence_verified',
  'missing_evidence',
  'needs_human_review',
  'noUnsupportedLawCitations',
  'unsupportedCitationWarnings',
]) {
  assert.ok(schemaSource.includes(requiredText), `schema should include ${requiredText}`);
}

const transpiled = ts.transpileModule(schemaSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
});
const tempModuleUrl = new URL('../.wave3-ai-review-schema-test.mjs', import.meta.url);
await fs.writeFile(tempModuleUrl, transpiled.outputText, 'utf8');
const { ClauseAiReviewSchema } = await import(pathToFileURL(tempModuleUrl.pathname));
await fs.rm(tempModuleUrl);

const deterministicMissingEvidence = ClauseAiReviewSchema.parse({
  schemaVersion: 'clause-review.v1',
  mode: 'deterministic_fallback',
  changeType: '절차 변경',
  risk: {
    riskScore: 74,
    riskDrivers: ['반드시 심의를 거쳐야 한다는 의무 표현'],
    practicalImpact: '담당부서의 사전 심의 절차가 필수화될 수 있습니다.',
    reviewQuestions: ['상위 규정 또는 법령 위임 근거가 확인되었는가?'],
    opinionDraft: '근거 확인 전까지는 검토 의견 초안으로만 사용합니다.',
  },
  legalEvidence: {
    status: 'missing_evidence',
    citations: [],
    missingEvidenceReason: 'Korean Law MCP evidence was not retrieved in deterministic fallback mode.',
    unsupportedCitationWarnings: ['kordoc MCP unavailable: evidence retrieval skipped'],
  },
  guardrails: {
    noFinalLegalAdvice: true,
    noUnsupportedLawCitations: true,
    humanReviewRequired: true,
    disclaimer: 'AI/MCP 검토는 법률 자문이 아니며 담당자 확인이 필요합니다.',
  },
});

assert.equal(deterministicMissingEvidence.mode, 'deterministic_fallback');
assert.equal(deterministicMissingEvidence.legalEvidence.status, 'missing_evidence');
assert.equal(deterministicMissingEvidence.legalEvidence.citations.length, 0);
assert.ok(deterministicMissingEvidence.legalEvidence.missingEvidenceReason);
assert.ok(deterministicMissingEvidence.legalEvidence.unsupportedCitationWarnings.some((warning) => /kordoc MCP unavailable/i.test(warning)));
assert.equal(deterministicMissingEvidence.guardrails.noUnsupportedLawCitations, true);
assert.equal(deterministicMissingEvidence.guardrails.humanReviewRequired, true);
assert.equal(deterministicMissingEvidence.modelInfo, undefined, 'deterministic fallback should not imply LLM use');

const verifiedCitation = ClauseAiReviewSchema.parse({
  schemaVersion: 'clause-review.v1',
  mode: 'ai_assisted',
  changeType: '상위법령 반영 의심',
  risk: {
    riskScore: 65,
    riskDrivers: ['상위법령 키워드가 포함된 개정 사유'],
    practicalImpact: '근거 조항 일치 여부 확인이 필요합니다.',
    reviewQuestions: ['인용 조항과 개정 문구가 직접 관련되는가?'],
    opinionDraft: '확인된 근거 범위에서만 인용합니다.',
  },
  legalEvidence: {
    status: 'evidence_verified',
    citations: [{
      source: 'Korean Law MCP',
      title: '고등교육법',
      article: '제6조',
      url: 'https://www.law.go.kr/법령/고등교육법',
      retrievedAt: '2026-04-27T00:00:00.000Z',
      quote: '학교의 규칙은 관계 법령의 범위에서 정한다.',
      verified: true,
    }],
    unsupportedCitationWarnings: [],
  },
  guardrails: {
    noFinalLegalAdvice: true,
    noUnsupportedLawCitations: true,
    humanReviewRequired: true,
    disclaimer: '확인된 citation도 최종 법률 검토를 대체하지 않습니다.',
  },
  modelInfo: { provider: 'fixture', model: 'contract-test' },
});

assert.equal(verifiedCitation.legalEvidence.status, 'evidence_verified');
assert.ok(verifiedCitation.legalEvidence.citations.every((citation) => citation.verified === true));

function assertNoInventedDisplayedCitations(review) {
  const unverified = review.legalEvidence.citations.filter((citation) => citation.verified !== true);
  assert.equal(unverified.length, 0, 'displayed legal citations must be verified evidence only');
  if (review.legalEvidence.status === 'evidence_verified') {
    assert.ok(review.legalEvidence.citations.length > 0, 'evidence_verified requires at least one citation');
  }
}

assertNoInventedDisplayedCitations(verifiedCitation);
assertNoInventedDisplayedCitations(deterministicMissingEvidence);

const parserConfidence = 0.42;
const legalRiskScore = deterministicMissingEvidence.risk.riskScore;
assert.ok(parserConfidence < 0.5, 'fixture keeps parser confidence low');
assert.ok(legalRiskScore >= 70, 'content/legal risk remains high despite parser confidence');

console.log('✓ Wave 3 AI/MCP contract fixtures validate deterministic fallback, missing evidence, verified citations, kordoc warnings, and parser-risk separation');
