import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import CFB from 'cfb';

const hwpPath = new URL('../fixtures/uploads/raw/2026-1st-temporary-regulation-committee-materials.hwp', import.meta.url);
const cfb = CFB.read(fs.readFileSync(hwpPath), { type: 'buffer' });
const fileHeader = CFB.find(cfb, 'FileHeader')?.content;
assert.ok(fileHeader, 'HWP FileHeader stream exists');
const compressed = (fileHeader.readUInt32LE(36) & 1) === 1;
const sections = cfb.FileIndex.filter((file) => /^Section\d+$/i.test(file.name) && file.content);
assert.ok(sections.length > 0, 'HWP BodyText section streams exist');

const text = sections.map((file) => extractText(file.content, compressed)).join('\n');
const required = [
  '2026학년도',
  '제1차 임시 규정심의위원회',
  '대학 학칙 개정(안)',
  '개정사유',
  '주요 개정내용',
  '신․구 조문 대비표',
  '별표Ⅰ',
  '입학정원표',
  '바이오헬스융합학부',
  '바이오식품공학과',
  '창의융합학부',
];

for (const keyword of required) {
  assert.ok(text.includes(keyword), `extracted HWP text includes ${keyword}`);
}

console.log(`✓ HWP fixture text extraction: ${sections.length} sections, ${text.length} chars`);
console.log(text.slice(text.indexOf('가. 개정사유'), text.indexOf('가. 개정사유') + 500));

function extractText(raw, compressed) {
  const data = compressed ? zlib.inflateRawSync(raw) : raw;
  const chunks = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const header = data.readUInt32LE(offset);
    offset += 4;
    const tagId = header & 0x3ff;
    let size = (header >>> 20) & 0xfff;
    if (size === 0xfff) {
      if (offset + 4 > data.length) break;
      size = data.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + size > data.length) break;
    const payload = data.subarray(offset, offset + size);
    offset += size;
    if (tagId === 67) {
      const text = payload.toString('utf16le')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/[\u3400-\u9fff]{2,}/g, '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /[가-힣A-Za-z0-9ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ<>()]/u.test(line))
        .join('\n')
        .replace(/[ \t\f\v]+/g, ' ')
        .trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join('\n');
}
