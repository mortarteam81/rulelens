import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const sourcePath = path.resolve('lib/comparison/hybrid.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;

const require = createRequire(import.meta.url);
const sandbox = { exports: {}, require, module: { exports: {} } };
sandbox.module.exports = sandbox.exports;
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
const { buildHybridComparisonTable } = sandbox.module.exports;
assert.equal(typeof buildHybridComparisonTable, 'function', 'buildHybridComparisonTable export exists');

const current = {
  regulationName: '성신여자대학교 학칙',
  sourceKind: 'sungshin',
  sourceFormat: 'html',
  currentHistory: '2026-03-01',
  rows: [
    row('s-1', '제1조(목적)', '', '제1조(목적) 이 학칙은 목적을 정한다.'),
    row('s-2', '제2조(정원)', '제2조(정원) 정원은 100명으로 한다.', '제2조(정원) 정원은 100명으로 한다.'),
    row('s-3', '제3조(폐지대상)', '', '제3조(폐지대상) 이 조는 현행에 있다.'),
  ],
  warnings: [],
};

const proposed = {
  regulationName: '성신여자대학교 학칙 개정안',
  sourceKind: 'upload',
  sourceFormat: 'pdf',
  rows: [
    row('u-1', '제1조(목적)', '제1조(목적) 이 학칙은 목적을 정한다.', '제1조(목적) 이 학칙은 교육 목적을 정한다.', '목적 명확화'),
    row('u-2', '제2조(정원)', '제2조(정원) 정원은 100명으로 한다.', '', '삭제'),
    row('u-3', '제4조(신설)', '', '제4조(신설) 새 조문을 둔다.', '신설'),
  ],
  warnings: ['PDF 휴리스틱'],
};

const hybrid = buildHybridComparisonTable(current, proposed);
assert.equal(hybrid.sourceKind, 'hybrid');
assert.equal(hybrid.regulationName, '성신여자대학교 학칙');
assert.equal(hybrid.previousHistory, '2026-03-01');
assert.equal(hybrid.currentHistory, '업로드 개정안');
assert.equal(hybrid.rows.length, 4);

const byArticle = new Map(hybrid.rows.map((r) => [r.article, r]));
assert.equal(byArticle.get('제1조(목적)')?.oldText, '제1조(목적) 이 학칙은 목적을 정한다.');
assert.equal(byArticle.get('제1조(목적)')?.newText, '제1조(목적) 이 학칙은 교육 목적을 정한다.');
assert.equal(byArticle.get('제1조(목적)')?.reason, '목적 명확화');
assert.equal(byArticle.get('제2조(정원)')?.newText, '');
assert.match(byArticle.get('제2조(정원)')?.warnings.join('\n') ?? '', /삭제로 분류/);
assert.equal(byArticle.get('제4조(신설)')?.oldText, '');
assert.match(byArticle.get('제4조(신설)')?.warnings.join('\n') ?? '', /같은 조문번호/);
assert.equal(byArticle.get('제3조(폐지대상)')?.newText, '');
assert.match(hybrid.warnings.join('\n'), /업로드 개정안: PDF 휴리스틱/);

const partialProposed = {
  regulationName: '성신여자대학교 학칙 일부 개정안',
  sourceKind: 'upload',
  sourceFormat: 'pdf',
  rows: [
    row('p-1', '별표Ⅰ 입학정원표', '현행 입학정원표', '개정 입학정원표', '입학정원 조정'),
  ],
  warnings: [],
};
const partialHybrid = buildHybridComparisonTable(current, partialProposed);
assert.equal(partialHybrid.rows.length, 1, 'partial upload should not turn every unmatched URL row into deletion');
assert.equal(partialHybrid.rows[0].article, '별표Ⅰ 입학정원표');
assert.equal(partialHybrid.rows[0].oldText, '현행 입학정원표');
assert.equal(partialHybrid.rows[0].newText, '개정 입학정원표');
assert.match(partialHybrid.warnings.join('\n'), /미매칭 조문을 삭제로 자동 분류하지 않았습니다/);

console.log(`✓ hybrid comparison fixture: ${hybrid.rows.length} rows; partial upload guard ${partialHybrid.rows.length} row`);

function row(id, article, oldText, newText, reason) {
  return { id, article, oldText, newText, reason, confidence: 0.9, warnings: [] };
}
