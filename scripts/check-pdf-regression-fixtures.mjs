import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parsePdfUpload } from '../lib/parsers/pdf.ts';

const thirdCommitteePdf = new URL('../fixtures/uploads/raw/2026-3rd-regulation-committee-materials.pdf', import.meta.url);
const bytes = await fs.readFile(thirdCommitteePdf);
const result = await parsePdfUpload('2026-3rd-regulation-committee-materials.pdf', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

assert.equal(result.sourceFormat, 'pdf');
assert.equal(result.sourceKind, 'upload');
assert.equal(result.rows.length, 8, 'multi-agenda PDF should split into article/appendix/supplementary rows');
assert.ok(result.rows.length < 20, 'regression guard: PDF table fragments must not explode into hundreds of rows');
assert.match(result.warnings.join('\n'), /pdfplumber|PDF 대비표 행은 휴리스틱/, 'should document PDF extraction path');

const articles = result.rows.map((row) => row.article ?? '').join('\n');
assert.match(articles, /제4조\(영역별 평가항목\)/, 'extracts 교원업적평가 제4조');
assert.match(articles, /제4조의4\(예술계열 교원의 연구업적 인정\)/, 'extracts 교원업적평가 제4조의4');
assert.match(articles, /<별표 영역별 평가항목 및 배점>/, 'extracts 교원업적평가 별표');
assert.match(articles, /제3조 \(구성\)/, 'extracts 기금운용심의회 제3조');
assert.match(articles, /제11조\(단장\)/, 'extracts 연구산학협력단 제11조');
assert.equal(result.rows.filter((row) => row.article === '부 칙').length, 3, 'splits supplementary provisions per agenda');

const byArticle = new Map(result.rows.map((row) => [row.article, row]));
const teacher = byArticle.get('제4조(영역별 평가항목)');
const artFaculty = byArticle.get('제4조의4(예술계열 교원의 연구업적 인정)');
const appendix = byArticle.get('<별표 영역별 평가항목 및 배점>');
const fund = byArticle.get('제3조 (구성)');
const research = byArticle.get('제11조(단장)');

assert.ok(teacher?.oldText.includes('연구영역의 평가항목'), 'teacher row preserves current column');
assert.ok(teacher?.newText.includes('필수업적(간접비)'), 'teacher row preserves revised column');
assert.ok(teacher?.reason?.includes('간접비'), 'teacher row preserves note/reason column');

assert.ok(artFaculty?.oldText.includes('초과강의'), 'art faculty row preserves current art faculty clause');
assert.ok(artFaculty?.newText.includes('필수요건'), 'art faculty row preserves revised art faculty clause');

assert.ok(appendix?.oldText.includes('석박사'), 'appendix row preserves current appendix content');
assert.ok(appendix?.newText.includes('공동지도교수'), 'appendix row preserves revised appendix content');

assert.ok(fund?.oldText.includes('외부전문가는 1명 이상'), 'fund row preserves old external expert count');
assert.ok(fund?.newText.includes('외부 전문가는 2명 이상'), 'fund row preserves new external expert count');
assert.ok(fund?.reason?.replace(/\s+/g, '').includes('상위법령개정반영'), 'fund row preserves legal-basis note');

assert.ok(research?.oldText.includes('임기는 2년'), 'research row preserves old term text');
assert.ok(research?.newText.includes('2년 미만의 기간'), 'research row preserves new exception text');
assert.ok(research?.reason?.replace(/\s+/g, '').includes('단서조항신설'), 'research row preserves proviso note');

for (const row of result.rows) {
  assert.ok((row.confidence ?? 0) >= 0.6, `expected practical parser confidence for ${row.article}`);
  if (row.article === '부 칙') {
    assert.ok(row.newText.length > 20, `supplementary provision should preserve revised text for ${row.article}`);
  } else {
    assert.ok(row.oldText.length > 20, `oldText should not be a tiny fragment for ${row.article}`);
    assert.ok(row.newText.length > 20, `newText should not be a tiny fragment for ${row.article}`);
  }
}

console.log(`✓ PDF regression fixture: ${result.rows.length} article/appendix/supplementary rows with restored columns`);
