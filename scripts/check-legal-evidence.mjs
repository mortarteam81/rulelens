import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const sourcePath = path.resolve('lib/mcp/korean-law-client.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  fileName: sourcePath,
}).outputText;

const require = createRequire(import.meta.url);
const sandbox = { exports: {}, require, module: { exports: {} } };
sandbox.module.exports = sandbox.exports;
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
const { MockLawEvidenceRetriever, KoreanLawMcpEvidenceRetriever, KoreanLawCliToolClient, createConfiguredKoreanLawEvidenceRetriever, checkLegalCompliance } = sandbox.module.exports;

assert.equal(typeof MockLawEvidenceRetriever, 'function', 'mock retriever export exists');
assert.equal(typeof KoreanLawMcpEvidenceRetriever, 'function', 'MCP adapter export exists');
assert.equal(typeof checkLegalCompliance, 'function', 'compliance helper export exists');
assert.equal(typeof KoreanLawCliToolClient, 'function', 'CLI client export exists');
assert.equal(typeof createConfiguredKoreanLawEvidenceRetriever, 'function', 'configured retriever factory export exists');

const verifiedRetriever = new MockLawEvidenceRetriever([
  {
    id: 'higher-education-act-19',
    source: 'mock',
    lawName: '고등교육법',
    articleNumber: '제19조',
    articleTitle: '학교의 조직',
    text: '학교에는 필요한 조직을 둔다.',
    citation: '고등교육법 제19조',
    confidence: 1,
  },
  {
    id: 'no-citation',
    source: 'mock',
    lawName: '고등교육법',
    articleNumber: '제99조',
    text: 'citation 없는 항목은 버려져야 한다.',
    citation: '',
  },
]);

const evidenceResult = await checkLegalCompliance({
  checkedAt: '2026-04-27T00:00:00.000Z',
  retriever: verifiedRetriever,
  clause: {
    article: '제4조(조직)',
    oldText: '기존 조직을 둔다.',
    newText: '필요한 조직을 둔다.',
    lawKeywords: ['고등교육법'],
  },
});
assert.equal(evidenceResult.status, '근거 확인');
assert.equal(evidenceResult.evidence.length, 1);
assert.equal(evidenceResult.evidence[0].citation, '고등교육법 제19조');
assert.equal(evidenceResult.missingEvidence.length, 0);

const missingResult = await checkLegalCompliance({
  checkedAt: '2026-04-27T00:00:00.000Z',
  retriever: new MockLawEvidenceRetriever(),
  clause: {
    article: '제8조(심의)',
    oldText: '심의할 수 있다.',
    newText: '반드시 심의를 거쳐야 한다.',
    lawKeywords: ['심의'],
  },
});
assert.equal(missingResult.status, '근거 미확인');
assert.equal(missingResult.evidence.length, 0);
assert.equal(missingResult.missingEvidence.length, 1);
assert.match(missingResult.warnings.join('\n'), /citation 없는 항목은 표시하지 않습니다/);

const noServerResult = await new KoreanLawMcpEvidenceRetriever().searchEvidence({ keywords: ['고등교육법'] });
assert.equal(noServerResult.length, 0, 'MCP adapter without client is safe empty fallback');

const conflictRetriever = new MockLawEvidenceRetriever([
  {
    id: 'refund-rule',
    source: 'mock',
    lawName: '대학 등록금에 관한 규칙',
    articleNumber: '제6조',
    text: '등록금은 정해진 기준에 따라 반환하여야 한다.',
    citation: '대학 등록금에 관한 규칙 제6조',
  },
]);
const conflictResult = await checkLegalCompliance({
  retriever: conflictRetriever,
  clause: {
    article: '제10조(등록금)',
    oldText: '등록금을 반환한다.',
    newText: '등록금은 반환하지 아니한다.',
    lawKeywords: ['등록금'],
  },
});
assert.equal(conflictResult.status, '충돌 가능성 있음');
assert.equal(conflictResult.missingEvidence.length, 0);

const toolCalls = [];
const liveShapeRetriever = new KoreanLawMcpEvidenceRetriever({
  async callTool(name, args) {
    toolCalls.push({ name, args });
    if (name === 'search_law') {
      return { results: [{ lawName: '사립학교법', mst: '000001', lawId: 'LAW001' }] };
    }
    if (name === 'get_law_text') {
      return {
        content: [{ type: 'text', text: '사립학교법 제32조의3(기금운용심의회의 설치 등) 외부 전문가는 2명 이상 포함하여야 한다.' }],
      };
    }
    return [];
  },
});
const liveShapeResult = await checkLegalCompliance({
  retriever: liveShapeRetriever,
  clause: {
    article: '제3조 (구성)',
    oldText: '외부전문가는 1명 이상 포함하여야 한다.',
    newText: '외부 전문가는 2명 이상 포함하여야 한다.',
    lawKeywords: ['사립학교법', '위원회'],
  },
});
assert.equal(liveShapeResult.status, '추가 확인 필요');
assert.equal(liveShapeResult.evidence.length, 1);
assert.equal(liveShapeResult.evidence[0].citation, '사립학교법 제32조의3');
assert.ok(toolCalls.some((call) => call.name === 'search_law'));
assert.ok(toolCalls.some((call) => call.name === 'get_law_text' && call.args.jo === '제32조의3'));

console.log('✓ legal evidence adapter fixtures: evidence, missingEvidence, no-server fallback, conflict status, live MCP tool shape');
