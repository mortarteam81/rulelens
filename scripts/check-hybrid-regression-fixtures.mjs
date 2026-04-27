import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const normalizerSource = await fs.readFile(new URL('../lib/parsers/normalize.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(normalizerSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
});
const tempModuleUrl = new URL('../.hybrid-normalizer-test.mjs', import.meta.url);
await fs.writeFile(tempModuleUrl, transpiled.outputText, 'utf8');
const { normalizeComparisonTable } = await import(pathToFileURL(tempModuleUrl.pathname));
await fs.rm(tempModuleUrl);

const REVIEW_RISK_PATTERN = /반드시|하여야|의무|제출|승인|심의|거쳐야|허용|반환하지 아니한다|신설|삭제/u;

function hasContentReviewRisk(row) {
  return REVIEW_RISK_PATTERN.test([row.oldText, row.newText, row.reason].filter(Boolean).join(' '));
}

function makeLongAppendixText(label) {
  const unit = `${label} 입학정원 조정 / 바이오헬스융합학부 / AI융합학부 / 실무 확인 필요. `;
  return unit.repeat(160);
}

const alreadyStructured = normalizeComparisonTable([
  ['조문', '구 조문', '신 조문', '개정사유'],
  ['제8조(심의 절차)', '부서장은 필요한 경우 위원회 심의를 요청할 수 있다.', '부서장은 개정안 시행 전 반드시 위원회 심의를 거쳐야 한다.', '심의 절차 의무화'],
], { sourceKind: 'upload', sourceFormat: 'text', idPrefix: 'structured' });

assert.equal(alreadyStructured.rows.length, 1);
assert.equal(alreadyStructured.rows[0].article, '제8조(심의 절차)');
assert.match(alreadyStructured.rows[0].oldText, /필요한 경우/);
assert.match(alreadyStructured.rows[0].newText, /반드시/);
assert.match(alreadyStructured.rows[0].reason, /의무화/);
assert.ok(alreadyStructured.rows[0].confidence >= 0.9, 'structured uploaded old/new table should remain high confidence');
assert.ok(hasContentReviewRisk(alreadyStructured.rows[0]), 'mandatory review wording should be flagged independently from confidence');

const lowConfidenceRisk = normalizeComparisonTable([
  { 현행: '담당부서는 자료를 제출할 수 있다.', 개정안: '담당부서는 7일 이내에 반드시 자료를 제출하여야 한다.', 개정사유: '자료 제출 의무 신설' },
], { sourceKind: 'upload', sourceFormat: 'text', idPrefix: 'risk' });

assert.equal(lowConfidenceRisk.rows.length, 1);
assert.equal(lowConfidenceRisk.rows[0].article, undefined);
assert.ok(lowConfidenceRisk.rows[0].confidence < 0.9, 'missing article should lower parser confidence');
assert.match(lowConfidenceRisk.rows[0].warnings.join('\n'), /조문 제목/);
assert.ok(hasContentReviewRisk(lowConfidenceRisk.rows[0]), 'low parser confidence must not hide content risk');

const appendixRows = normalizeComparisonTable([
  ['조문', '현행', '개정안', '개정사유'],
  ['별표 1', makeLongAppendixText('현행 A'), makeLongAppendixText('개정 A'), '입학정원 조정'],
  ['별표 1', makeLongAppendixText('현행 B'), makeLongAppendixText('개정 B'), '학과명 정비'],
], { sourceKind: 'upload', sourceFormat: 'text', idPrefix: 'appendix' });

assert.equal(appendixRows.rows.length, 2, 'duplicate 별표 rows must remain separate');
assert.equal(appendixRows.rows[0].article, '별표 1');
assert.equal(appendixRows.rows[1].article, '별표 1');
assert.notEqual(appendixRows.rows[0].id, appendixRows.rows[1].id);
assert.ok(appendixRows.rows[0].oldText.length > 4000, 'long 별표 oldText should not be truncated');
assert.ok(appendixRows.rows[0].newText.length > 4000, 'long 별표 newText should not be truncated');

if (process.env.HYBRID_ANALYZE_URL) {
  const body = new FormData();
  body.set('sourceUrl', 'https://rule.sungshin.ac.kr/service/law/lawChangeList.do?seq=fixture&historySeq=fixture');
  body.set('regulationName', '하이브리드 QA 규정');
  body.set('purpose', 'hybrid smoke');
  body.set('file', new Blob([
    '조문\t구 조문\t신 조문\t개정사유\n',
    '제8조(심의 절차)\t임의 심의\t반드시 심의\t절차 강화\n',
  ], { type: 'text/tab-separated-values;charset=utf-8' }), 'hybrid-amendment.tsv');

  const response = await fetch(process.env.HYBRID_ANALYZE_URL, { method: 'POST', body });
  assert.ok(response.ok, `hybrid /api/analyze smoke failed: ${response.status} ${await response.text()}`);
  const json = await response.json();
  assert.ok(Array.isArray(json.clauses), 'hybrid API response should include clauses');
  assert.ok(json.clauses.some((clause) => /제8조|심의/.test(`${clause.article} ${clause.newText}`)), 'hybrid API should include uploaded amendment rows');
  console.log(`✓ hybrid API smoke: ${json.clauses.length} clauses`);
} else {
  console.log('↷ hybrid API smoke skipped (set HYBRID_ANALYZE_URL to run it)');
}

console.log(`✓ uploaded old/new table preserved: ${alreadyStructured.rows.length} row`);
console.log('✓ parser confidence and content risk checked independently');
console.log(`✓ duplicate long 별표 rows preserved: ${appendixRows.rows.length} rows`);
