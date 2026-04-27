import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const samples = JSON.parse(await fs.readFile(new URL('../fixtures/sungshin/samples.json', import.meta.url), 'utf8'));
const origin = 'https://rule.sungshin.ac.kr';

function normalizeSungshinLawChangeListUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.origin !== origin) return undefined;
  const supportedPaths = new Set([
    '/service/law/lawChangeList.do',
    '/service/law/lawFullScreen.do',
    '/service/law/lawView.do',
    '/service/law/lawTwoView.do',
    '/service/law/lawFullScreenContent.do',
  ]);
  if (!supportedPaths.has(url.pathname)) return undefined;
  const seq = url.searchParams.get('seq');
  const historySeq = url.searchParams.get('historySeq');
  if (!seq || !historySeq) return undefined;
  return `${origin}/service/law/lawChangeList.do?seq=${encodeURIComponent(seq)}&historySeq=${encodeURIComponent(historySeq)}`;
}

function parse(html) {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  const regulationName = title.split('|').map(cleanText).filter(Boolean).at(-1);
  const previousHistory = html.match(/이전\s*연혁\s*\(([^)]+)\)/)?.[1];
  const currentHistory = html.match(/현재\s*연혁\s*\(([^)]+)\)/)?.[1];
  const declaredCount = Number(html.match(/총\s*<b>(\d+)<\/b>\s*개 조항/)?.[1] ?? 0);
  const cellCount = [...html.matchAll(/<td\b[^>]*class="btxt"[^>]*>/gi)].length;
  return { regulationName, previousHistory, currentHistory, declaredCount, rowCount: cellCount / 2 };
}

function cleanText(input) {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

let passed = 0;
for (const sample of samples) {
  const normalized = normalizeSungshinLawChangeListUrl(sample.url);
  assert.equal(normalized, sample.normalizedUrl, `${sample.id}: normalized URL mismatch`);
  const response = await fetch(normalized, { headers: { 'user-agent': 'regdiff-dashboard-fixture-check/0.1' } });
  assert.equal(response.ok, true, `${sample.id}: HTTP ${response.status}`);
  const html = await response.text();
  const parsed = parse(html);
  assert.equal(parsed.regulationName, sample.expected.regulationName, `${sample.id}: regulationName`);
  assert.equal(parsed.previousHistory, sample.expected.previousHistory, `${sample.id}: previousHistory`);
  assert.equal(parsed.currentHistory, sample.expected.currentHistory, `${sample.id}: currentHistory`);
  assert.equal(parsed.declaredCount, sample.expected.rowCount, `${sample.id}: declared count`);
  assert.equal(parsed.rowCount, sample.expected.rowCount, `${sample.id}: parsed row count`);
  console.log(`✓ ${sample.id}: ${parsed.regulationName} / ${parsed.currentHistory} / ${parsed.rowCount} rows`);
  passed += 1;
}
console.log(`\n${passed}/${samples.length} Sungshin fixtures passed.`);
