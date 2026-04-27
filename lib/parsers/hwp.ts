import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { promisify } from 'node:util';
import * as CFB from 'cfb';
import type { ParsedComparisonTable } from '@/lib/parsers/types';
import { cleanText, rowsFromPlainText } from '@/lib/parsers/upload-normalize';

const execFileAsync = promisify(execFile);
const COMMAND_CANDIDATES = ['hwp5txt', 'pyhwp'];

export async function parseLegacyHwp(bytes: ArrayBuffer, fileName: string): Promise<ParsedComparisonTable> {
  const jsResult = parseHwp5TextWithCfb(bytes, fileName);
  if (jsResult.rows.length > 0) return jsResult;

  const command = await findAvailableCommand(COMMAND_CANDIDATES);
  if (!command) {
    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwp',
      rows: [],
      warnings: [
        ...jsResult.warnings,
        'Legacy HWP sidecar 어댑터는 준비됐지만 로컬 hwp5txt/pyhwp 명령을 찾지 못했습니다.',
        '설치 후 재시도하세요. 예: pyhwp 패키지의 hwp5txt가 PATH에 있어야 합니다.',
      ],
    };
  }

  const workDir = path.join(tmpdir(), `regdiff-hwp-${randomUUID()}`);
  const inputPath = path.join(workDir, sanitizeFileName(fileName) || 'upload.hwp');

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(inputPath, Buffer.from(bytes));
    const { stdout, stderr } = await execFileAsync(command, [inputPath], {
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });

    const rows = rowsFromPlainText(stdout, 'hwp-text');
    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwp',
      rows,
      warnings: [
        `Legacy HWP를 ${command} 어댑터로 텍스트 변환했습니다. 표/셀 경계는 보존되지 않을 수 있습니다.`,
        ...(stderr.trim() ? [`${command} stderr: ${stderr.trim().slice(0, 500)}`] : []),
        ...(rows.length ? [] : ['변환된 텍스트에서 조문 단위를 찾지 못했습니다.']),
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwp',
      rows: [],
      warnings: [`Legacy HWP ${command} 변환 실패: ${message}`],
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function parseHwp5TextWithCfb(bytes: ArrayBuffer, fileName: string): ParsedComparisonTable {
  const warnings = ['Legacy HWP를 JS CFB/zlib 프로토타입으로 텍스트 추출했습니다. 복잡한 표 병합과 서식 정보는 보존되지 않을 수 있습니다.'];

  try {
    const cfb = CFB.read(Buffer.from(bytes), { type: 'buffer' });
    const fileHeaderContent = CFB.find(cfb, 'FileHeader')?.content;
    if (!fileHeaderContent) throw new Error('FileHeader stream 없음');
    const fileHeader = Buffer.from(fileHeaderContent);

    const compressed = (fileHeader.readUInt32LE(36) & 1) === 1;
    const sectionFiles = cfb.FileIndex
      .filter((file) => /^Section\d+$/i.test(file.name) && file.content)
      .sort((a, b) => a.name.localeCompare(b.name));

    if (sectionFiles.length === 0) throw new Error('BodyText/Section stream 없음');

    const text = sectionFiles
      .map((file) => extractSectionText(Buffer.from(file.content), compressed))
      .join('\n')
      .trim();
    const rows = rowsFromPlainText(text, 'hwp-js');

    if (rows.length === 0) warnings.push('HWP 본문 텍스트는 추출했지만 신구조문 대비표를 식별하지 못했습니다.');

    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwp',
      rows,
      warnings,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      regulationName: stripExtension(fileName),
      sourceKind: 'upload',
      sourceFormat: 'hwp',
      rows: [],
      warnings: [`JS HWP5 텍스트 추출 실패: ${message}`],
    };
  }
}

function extractSectionText(raw: Buffer, compressed: boolean): string {
  const data = compressed ? inflateRawSync(raw) : raw;
  const chunks: string[] = [];
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
    if (size < 0 || offset + size > data.length) break;
    const payload = data.subarray(offset, offset + size);
    offset += size;

    if (tagId === 67) {
      const text = cleanHwpTextChunk(payload.toString('utf16le'));
      if (text) chunks.push(text);
    }
  }

  return cleanText(chunks.join('\n'));
}

function cleanHwpTextChunk(input: string): string {
  return cleanText(
    input
      .split(/\r?\n/)
      .map((line) => line.replace(/[\u0000-\u001f]/g, '').replace(/[\u3400-\u9fff]{2,}/g, '').trim())
      .filter((line) => /[가-힣A-Za-z0-9ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ<>()]/u.test(line))
      .join('\n'),
  );
}

async function findAvailableCommand(commands: string[]): Promise<string | undefined> {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const command of commands) {
    for (const entry of pathEntries) {
      const candidate = path.join(entry, command);
      try {
        await access(candidate);
        return command;
      } catch {
        // try next path entry
      }
    }
  }
  return undefined;
}

function sanitizeFileName(fileName: string): string {
  return path.basename(fileName).replace(/[^\p{L}\p{N}._-]+/gu, '_');
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}
