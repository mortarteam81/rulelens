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
const tempModuleUrl = new URL('../.normalizer-test.mjs', import.meta.url);
await fs.writeFile(tempModuleUrl, transpiled.outputText, 'utf8');
const { normalizeComparisonTable, normalizeHeaderLabel } = await import(pathToFileURL(tempModuleUrl.pathname));
await fs.rm(tempModuleUrl);

const fixture = await fs.readFile(new URL('../fixtures/normalizer/korean-comparison.tsv', import.meta.url), 'utf8');
const realWorldFixture = await fs.readFile(new URL('../fixtures/normalizer/real-world-admissions-table.tsv', import.meta.url), 'utf8');

assert.equal(normalizeHeaderLabel('현행'), 'oldText');
assert.equal(normalizeHeaderLabel('개정안'), 'newText');
assert.equal(normalizeHeaderLabel('개정후'), 'newText');
assert.equal(normalizeHeaderLabel('개정사유'), 'reason');
assert.equal(normalizeHeaderLabel('비고'), 'note');

const table = normalizeComparisonTable(fixture, {
  regulationName: '테스트 규정',
  sourceKind: 'upload',
  sourceFormat: 'text',
  idPrefix: 'fixture',
});

assert.equal(table.regulationName, '테스트 규정');
assert.equal(table.rows.length, 5);
assert.deepEqual(table.warnings, []);
assert.equal(table.rows[0].id, 'fixture-1');
assert.equal(table.rows[0].article, '제4조(위원회 구성)');
assert.match(table.rows[0].oldText, /7인 이내/);
assert.match(table.rows[0].newText, /9인 이내/);
assert.equal(table.rows[1].article, '제12조(자료 제출)');
assert.equal(table.rows[1].oldText, '');
assert.match(table.rows[1].newText, /7일 이내/);
assert.match(table.rows[1].reason, /신설/);
assert.equal(table.rows[2].article, '제18조(서류 보관)');
assert.match(table.rows[2].oldText, /5년간/);
assert.equal(table.rows[2].newText, '');
assert.match(table.rows[2].reason, /삭제/);
assert.equal(table.rows[3].article, '부칙');
assert.equal(table.rows[4].article, '별표 1');
assert.match(table.rows[4].reason, /별표 개정/);

const aliasRows = normalizeComparisonTable([
  { 조문: '별지 제1호', 현행규정: '서식 A', 개정후: '서식 B', 개정이유: '별지 정비' },
  { 조항: '제3조', 종전: '문구', 신조문: '문구 변경', 비고: '자구 수정' },
], { sourceKind: 'manual', idPrefix: 'alias' });

assert.equal(aliasRows.rows.length, 2);
assert.equal(aliasRows.rows[0].article, '별지 제1호');
assert.equal(aliasRows.rows[0].oldText, '서식 A');
assert.equal(aliasRows.rows[0].newText, '서식 B');
assert.equal(aliasRows.rows[1].article, '제3조');
assert.match(aliasRows.rows[1].reason, /자구 수정/);

const admissionsTable = normalizeComparisonTable(realWorldFixture, {
  regulationName: '성신여자대학교 학칙',
  sourceKind: 'upload',
  sourceFormat: 'text',
  idPrefix: 'admissions',
});

assert.equal(admissionsTable.rows.length, 2);
assert.equal(admissionsTable.rows[0].article, '별표Ⅰ');
assert.match(admissionsTable.rows[0].oldText, /바이오헬스융합학부/);
assert.match(admissionsTable.rows[0].oldText, /<신설> -/);
assert.match(admissionsTable.rows[0].newText, /\(삭제\) -/);
assert.match(admissionsTable.rows[0].newText, /바이오식품공학과 26/);
assert.match(admissionsTable.rows[0].reason, /입학정원 조정/);
assert.doesNotMatch(admissionsTable.rows[0].oldText, /^현 행$/m);
assert.doesNotMatch(admissionsTable.rows[0].newText, /^개 정\(안\)$/m);
assert.equal(admissionsTable.rows[1].article, '부칙');
assert.match(admissionsTable.rows[1].newText, /제2항 제1호를 삭제/);

console.log(`✓ normalizer TSV fixture: ${table.rows.length} rows`);
console.log(`✓ normalizer alias object rows: ${aliasRows.rows.length} rows`);
console.log(`✓ real-world admissions table fixture: ${admissionsTable.rows.length} rows`);
