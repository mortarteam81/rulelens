import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

async function transpileTsToMjs(sourceUrl, outputUrl, rewrite = (code) => code) {
  const source = await fs.readFile(sourceUrl, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
  });
  await fs.writeFile(outputUrl, rewrite(transpiled.outputText), 'utf8');
}

const normalizeUrl = new URL('../.kordoc-normalize-test.mjs', import.meta.url);
const adapterUrl = new URL('../.kordoc-adapter-test.mjs', import.meta.url);
await transpileTsToMjs(new URL('../lib/parsers/normalize.ts', import.meta.url), normalizeUrl);
await transpileTsToMjs(
  new URL('../lib/parsers/kordoc-adapter.ts', import.meta.url),
  adapterUrl,
  (code) => code.replace("from './normalize';", "from './.kordoc-normalize-test.mjs';"),
);

try {
  const { KordocAdapter } = await import(pathToFileURL(adapterUrl.pathname));

  const unavailable = new KordocAdapter({
    runner: async () => {
      throw new Error('npx not found in test');
    },
    env: {},
  });
  const unavailableDetection = await unavailable.detect();
  assert.equal(unavailableDetection.available, false);
  assert.equal(unavailableDetection.mode, 'unavailable');
  assert.match(unavailableDetection.warnings.join('\n'), /kordoc CLI를 찾지 못했습니다/);

  const unavailableTable = await unavailable.parseTable({
    fileName: 'regulation.hwp',
    sourceFormat: 'hwp',
    bytes: new TextEncoder().encode('fake').buffer,
  });
  assert.equal(unavailableTable.rows.length, 0);
  assert.match(unavailableTable.warnings.join('\n'), /fallback|대체/);

  const mcpConfigured = new KordocAdapter({
    runner: async () => ({ stdout: '', stderr: '' }),
    env: { KORDOC_MCP_URL: 'stdio://kordoc-test' },
  });
  const mcpDetection = await mcpConfigured.detect();
  assert.equal(mcpDetection.mode, 'mcp-configured');
  assert.equal(mcpDetection.available, false);
  assert.match(mcpDetection.warnings.join('\n'), /MCP/);

  const calls = [];
  const available = new KordocAdapter({
    runner: async (file, args) => {
      calls.push({ file, args });
      assert.ok(file === 'npx' || /node_modules\/\.bin\/kordoc(?:\.cmd)?$/.test(file), `unexpected kordoc command ${file}`);
      if (file === 'npx') assert.deepEqual(args.slice(0, 2), ['--no-install', 'kordoc']);
      if (args.includes('--version')) return { stdout: 'kordoc 2.4.0\n', stderr: '' };
      return {
        stdout: [
          '| 조문 | 현행 | 개정안 | 개정사유 |',
          '| --- | --- | --- | --- |',
          '| 제1조(목적) | 목적을 정한다. | 교육 목적을 정한다. | 목적 명확화 |',
        ].join('\n'),
        stderr: '',
      };
    },
    env: {},
  });

  const documentResult = await available.parseDocument({
    fileName: '학칙.hwpx',
    sourceFormat: 'hwpx',
    bytes: new TextEncoder().encode('fake hwpx').buffer,
  });
  assert.equal(documentResult.ok, true);
  assert.match(documentResult.markdown, /제1조/);

  const table = await available.parseTable({
    fileName: '학칙.hwpx',
    sourceFormat: 'hwpx',
    bytes: new TextEncoder().encode('fake hwpx').buffer,
  });
  assert.equal(table.rows.length, 1, 'markdown separator row should be stripped before normalization');
  assert.equal(table.rows[0].article, '제1조(목적)');
  assert.match(table.rows[0].newText, /교육 목적/);
  assert.match(table.warnings.join('\n'), /kordoc parse_table/);
  assert.ok(calls.length >= 4, 'detect + parse calls are mocked and observed');

  const comparison = await available.compareDocuments({
    previous: { fileName: 'old.hwp', sourceFormat: 'hwp', bytes: new ArrayBuffer(0) },
    current: { fileName: 'new.hwp', sourceFormat: 'hwp', bytes: new ArrayBuffer(0) },
    regulationName: '테스트 규정',
  });
  assert.equal(comparison.regulationName, '테스트 규정');
  assert.equal(comparison.rows.length, 0);
  assert.match(comparison.warnings.join('\n'), /compare_documents/);

  console.log('✓ kordoc adapter graceful unavailable/MCP detection/local CLI mocks');
} finally {
  await fs.rm(normalizeUrl, { force: true });
  await fs.rm(adapterUrl, { force: true });
}
