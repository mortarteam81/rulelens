import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleCache = new Map();

function loadTsModule(relativePath) {
  const sourcePath = path.resolve(relativePath);
  if (moduleCache.has(sourcePath)) return moduleCache.get(sourcePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require: (specifier) => {
      if (specifier === './schemas') return loadTsModule('lib/ai-review/schemas.ts');
      if (specifier === './fallback') return loadTsModule('lib/ai-review/fallback.ts');
      return require(specifier);
    },
  };
  sandbox.module.exports = sandbox.exports;
  vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
  moduleCache.set(sourcePath, sandbox.module.exports);
  return sandbox.module.exports;
}

const { ClauseAiReviewSchema } = loadTsModule('lib/ai-review/schemas.ts');
const { buildDeterministicClauseReview } = loadTsModule('lib/ai-review/fallback.ts');

const fixturePath = path.resolve('fixtures/ai-review/clause-review.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const parsedFixture = ClauseAiReviewSchema.parse(fixture);
assert.equal(parsedFixture.guardrails.noFinalLegalAdvice, true);
assert.equal(parsedFixture.guardrails.noUnsupportedLawCitations, true);
assert.equal(parsedFixture.legalEvidence.status, 'missing_evidence');
assert.equal(parsedFixture.legalEvidence.citations.length, 0);

const fallback = buildDeterministicClauseReview({
  row: {
    id: 'fixture-1',
    article: '제12조(자료 제출)',
    oldText: '',
    newText: '관련 부서는 위원회 요청 시 7일 이내에 검토자료를 제출하여야 한다.',
    reason: '자료 제출 근거 신설',
    confidence: 0.92,
    warnings: [],
  },
  changeType: '신설',
  riskScore: 72,
  lawKeywords: ['관련 상위규정', '위임 근거'],
});

ClauseAiReviewSchema.parse(fallback);
assert.equal(fallback.mode, 'deterministic_fallback');
assert.equal(fallback.legalEvidence.status, 'missing_evidence');
assert.equal(fallback.guardrails.humanReviewRequired, true);
assert.match(fallback.guardrails.disclaimer, /최종 법률자문/);
assert.ok(fallback.risk.reviewQuestions.some((question) => question.includes('citation')));
assert.ok(fallback.legalEvidence.unsupportedCitationWarnings.every((warning) => warning.includes('citation 미검증')));

const repeated = buildDeterministicClauseReview({
  row: {
    id: 'fixture-1',
    article: '제12조(자료 제출)',
    oldText: '',
    newText: '관련 부서는 위원회 요청 시 7일 이내에 검토자료를 제출하여야 한다.',
    reason: '자료 제출 근거 신설',
    confidence: 0.92,
    warnings: [],
  },
  changeType: '신설',
  riskScore: 72,
  lawKeywords: ['관련 상위규정', '위임 근거'],
});
assert.deepEqual(repeated, fallback, 'deterministic fallback is stable');

console.log('✓ AI review schema fixture and deterministic fallback checks passed');
