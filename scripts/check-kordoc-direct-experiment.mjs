import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const kordocBin = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'kordoc.cmd' : 'kordoc');

async function runKordoc(filePath) {
  try {
    const { stdout, stderr } = await execFileAsync(kordocBin, [filePath], {
      timeout: 45_000,
      maxBuffer: 24 * 1024 * 1024,
      encoding: 'utf8',
    });
    return { ok: stdout.trim().length > 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) };
  }
}

await fs.access(kordocBin);
const version = await execFileAsync(kordocBin, ['--version'], { encoding: 'utf8' });
assert.match(version.stdout || version.stderr, /\d+\.\d+\.\d+/, 'kordoc local binary reports version');

const samples = [
  {
    path: 'fixtures/uploads/raw/2026-1st-temporary-regulation-committee-materials.hwp',
    required: [/대학 학칙 개정\(안\)/, /신․구 조문 대비표/, /별표Ⅰ[_\s]*입학정원표/],
  },
  {
    path: 'fixtures/uploads/raw/2026-1st-temporary-regulation-committee-materials.pdf',
    required: [/현 행|현행/, /개 정\(안\)|개정\(안\)/, /별표Ⅰ|입학정원표/],
  },
  {
    path: 'fixtures/uploads/raw/2026-3rd-regulation-committee-materials.pdf',
    required: [/교원업적평가 규정 개정\(안\)/, /제3조 \(구성\)/, /제11조\(단장\)/, /현행\|개정\(안\)\|비고|현 행|개 정\(안\)/],
  },
];

for (const sample of samples) {
  const result = await runKordoc(sample.path);
  assert.equal(result.ok, true, `kordoc parses ${sample.path}: ${result.stderr.slice(0, 500)}`);
  for (const pattern of sample.required) {
    assert.match(result.stdout, pattern, `kordoc output for ${sample.path} contains ${pattern}`);
  }
}

console.log(`✓ kordoc direct experiment: ${samples.length} samples parsed with local kordoc CLI`);
