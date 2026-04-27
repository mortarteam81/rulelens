#!/usr/bin/env node
import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

function emit(payload, status = 0) {
  console.log(JSON.stringify(payload));
  process.exit(status);
}

const pdfPath = process.argv[2];
if (!pdfPath) emit({ ok: false, error: 'usage', warnings: ['Usage: extract-pdf-text.mjs <pdf-path>'] }, 2);

let parser;
try {
  const data = await fs.readFile(pdfPath);
  parser = new PDFParse({ data });
  const result = await parser.getText();
  emit({
    ok: true,
    engine: 'pdf-parse',
    pages: (result.pages ?? []).map((page, index) => ({ page: page.num ?? index + 1, text: page.text ?? '' })),
    warnings: ['PDF 텍스트를 JS pdf-parse child-process adapter로 추출했습니다. 표 셀 경계는 일부 손실될 수 있습니다.'],
  });
} catch (error) {
  emit({ ok: false, error: 'pdf-parse-failed', warnings: [error instanceof Error ? error.message : String(error)] });
} finally {
  if (parser) await parser.destroy().catch(() => undefined);
}
