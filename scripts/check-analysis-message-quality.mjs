import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();

function loadTsModule(modulePath) {
  const resolved = resolveTsPath(modulePath);
  if (cache.has(resolved)) return cache.get(resolved).exports;

  const source = fs.readFileSync(resolved, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: resolved,
  }).outputText;

  const module = { exports: {} };
  cache.set(resolved, module);
  const localRequire = (specifier) => {
    if (specifier.startsWith('@/')) return loadTsModule(path.join(root, specifier.slice(2)));
    if (specifier.startsWith('.')) return loadTsModule(path.resolve(path.dirname(resolved), specifier));
    if (specifier.startsWith('node:')) return nodeRequire(specifier);
    return nodeRequire(specifier);
  };

  vm.runInNewContext(compiled, { exports: module.exports, module, require: localRequire, console, process, Buffer, setTimeout, clearTimeout }, { filename: resolved });
  return module.exports;
}

function resolveTsPath(input) {
  const candidates = [];
  if (path.extname(input)) candidates.push(input);
  candidates.push(`${input}.ts`, `${input}.tsx`, `${input}.js`, `${input}.mjs`, path.join(input, 'index.ts'));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  throw new Error(`Cannot resolve ${input}`);
}

const { parsePdfUpload } = loadTsModule(path.join(root, 'lib/parsers/pdf.ts'));
const { analyzeRegulation } = loadTsModule(path.join(root, 'lib/analyzer.ts'));

const fixture = path.join(root, 'fixtures/uploads/raw/2026-3rd-regulation-committee-materials.pdf');
const bytes = fs.readFileSync(fixture);
const parsedTable = await parsePdfUpload('2026-3rd-regulation-committee-materials.pdf', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const result = await analyzeRegulation({ regulationName: '제3차 규정심의위원회', purpose: '실무검토용', sourceFormat: 'pdf', parsedTable, inputMode: 'file-only' });

const byArticle = new Map(result.clauses.map((clause) => [clause.article, clause]));

const teacher = byArticle.get('제4조(영역별 평가항목)');
assert.ok(teacher, 'teacher article exists');
assert.match(teacher.summary, /연구영역 평가항목.*필수업적\(논문등\).*필수업적\(간접비\)/, 'teacher summary is domain-specific');
assert.match(teacher.impact, /교원업적평가 산정 방식/, 'teacher impact explains practical scoring impact');
assert.ok(teacher.questions.some((q) => q.includes('90%') && q.includes('10%')), 'teacher questions include formula check');

const appendix = byArticle.get('<별표 영역별 평가항목 및 배점>');
assert.ok(appendix, 'appendix exists');
assert.match(appendix.summary, /석·박사 배출.*공동지도교수 배점 기준/, 'appendix summary explains score table change');
assert.ok(appendix.questions.some((q) => q.includes('50:50')), 'appendix questions include 50:50 check');

const fund = byArticle.get('제3조 (구성)');
assert.ok(fund, 'fund article exists');
assert.equal(fund.changeType, '상위법령 반영 의심');
assert.match(fund.summary, /외부전문가 요건.*1명 이상.*2명 이상/, 'fund summary explains legal-basis count change');
assert.match(fund.opinionDraft, /사립학교법 최신 조문 citation/, 'fund opinion asks for citation verification');

const research = byArticle.get('제11조(단장)');
assert.ok(research, 'research article exists');
assert.match(research.summary, /2년 미만.*예외 단서/, 'research summary explains short-term exception');
assert.ok(research.questions.some((q) => q.includes('특별한 사유')), 'research questions ask special reason criteria');

for (const clause of result.clauses) {
  assert.doesNotMatch(clause.summary, /^표현 또는 운영 기준이 일부 정비되었습니다\.$/, `summary should not be generic for ${clause.article}`);
  assert.ok(clause.opinionDraft.length > 40, `opinion draft should be useful for ${clause.article}`);
}

console.log(`✓ analysis message quality fixture: ${result.clauses.length} clauses with domain-specific summaries`);
