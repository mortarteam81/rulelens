import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

const fixturePath = new URL('../fixtures/uploads/raw/2026-1st-temporary-regulation-committee-materials.pdf', import.meta.url);
const bytes = await fs.readFile(fixturePath);
const parser = new PDFParse({ data: bytes });

try {
  const result = await parser.getText();
  const text = result.text.replace(/\s+/g, ' ');

  assert.equal(result.total, 6, 'expected six pages');
  assert.match(text, /2026학\s*년\s*도/, 'extracts Korean cover text');
  assert.match(text, /대학\s*학칙\s*개정\(안\)/, 'extracts 대학 학칙 개정(안) heading');
  assert.match(text, /개정사유/, 'extracts 개정사유 section');
  assert.match(text, /주요\s*개정내용/, 'extracts 주요 개정내용 section');
  assert.match(text, /신[․·ㆍ･]?구\s*조문\s*대비표/, 'extracts 신구 조문 대비표 heading');
  assert.match(text, /별표Ⅰ[_\s]*입학정원표/, 'extracts 별표Ⅰ 입학정원표 table marker');
  assert.match(text, /바이오헬스융합학부/, 'extracts table Korean department content');
  assert.match(text, /창의융합학부/, 'extracts revised table content');

  console.log(`✓ PDF fixture text extraction passed: ${result.total} pages, ${text.length} normalized chars`);
} finally {
  await parser.destroy();
}
