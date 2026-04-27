'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Gavel,
  LinkIcon,
  UploadCloud,
} from 'lucide-react';
import type { AnalysisResult, ClauseAnalysis } from '@/lib/types';
import { simpleDiff } from '@/lib/diff';

type InputMode = 'url-only' | 'file-only' | 'hybrid' | 'empty';

type SourceMeta = {
  role?: string;
  label?: string;
  kind?: string;
  format?: string;
  name?: string;
  url?: string;
  rowCount?: number;
  confidence?: number;
  warnings?: string[];
};

type HybridSummary = {
  mode?: string;
  baselineLabel?: string;
  amendmentLabel?: string;
  comparedRows?: number;
  summary?: string;
  warnings?: string[];
};

type ExtendedResult = AnalysisResult & {
  inputMode?: InputMode;
  sourceMetadata?: SourceMeta[];
  hybridComparisonSummary?: HybridSummary;
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [regulationName, setRegulationName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ExtendedResult | null>(null);
  const [selected, setSelected] = useState<ClauseAnalysis | null>(null);

  const inputMode = getInputMode(Boolean(sourceUrl.trim()), Boolean(file));

  async function submit() {
    const hasUrl = Boolean(sourceUrl.trim());
    const hasFile = Boolean(file);
    if (!hasUrl && !hasFile) {
      setError('성신 규정 URL 또는 개정안 파일 중 하나 이상을 입력하세요.');
      return;
    }

    const fd = new FormData();
    if (file) fd.append('file', file);
    if (hasUrl) fd.append('sourceUrl', sourceUrl.trim());
    fd.append('regulationName', regulationName);
    fd.append('purpose', '실무검토용');

    setLoading(true);
    setError('');
    const res = await fetch('/api/analyze', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || '분석에 실패했습니다.');
      setLoading(false);
      return;
    }
    setResult(data);
    setSelected(data.clauses?.[0] || null);
    setLoading(false);
  }

  const clauses = result?.clauses || [];

  return (
    <main className="min-h-screen p-6 md:p-10">
      <section className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-bold text-blue-600">Regulation Diff Intelligence</p>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">규정 신구조문 대비표 분석 대시보드</h1>
            <p className="mt-2 text-gray-600">URL 현행 규정과 업로드 개정안을 함께 비교하는 실무 검토 흐름</p>
          </div>
          <div className="rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">외부 접속 웹앱 MVP · MCP 연동 준비</div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          <aside className="card p-5 space-y-4">
            <div className="flex items-center gap-2 font-bold"><UploadCloud size={20} /> URL 또는 파일 입력</div>
            <ModeGuide mode={inputMode} />

            <label className="block">
              <span className="text-sm text-gray-600">성신 규정 URL · 기준/현행 규정</span>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                <LinkIcon size={16} />
                <input
                  className="w-full outline-none"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder="https://rule.sungshin.ac.kr/service/law/lawChangeList.do?..."
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">URL만 입력하면 공개 신구조문 대비표를 URL 단독 모드로 분석합니다.</p>
            </label>

            <label className="block">
              <span className="text-sm text-gray-600">규정명</span>
              <input
                className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2"
                value={regulationName}
                onChange={e => setRegulationName(e.target.value)}
                placeholder="예: 학칙 시행세칙"
              />
            </label>

            <label className="block rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 p-5 text-center cursor-pointer">
              <input type="file" accept=".hwp,.hwpx,.pdf" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
              <FileText className="mx-auto mb-2" />
              <div className="font-bold">HWP/HWPX/PDF 선택 · 제안 개정안</div>
              <div className="text-sm text-gray-500">{file ? file.name : '파일만 입력하면 업로드 단독 모드로 분석합니다.'}</div>
            </label>

            {inputMode === 'hybrid' && (
              <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-950">
                <b>하이브리드 모드</b><br />
                URL은 <b>기준/현행 규정</b>, 업로드 파일은 <b>제안 개정안</b>으로 표시합니다.
              </div>
            )}
            {error && <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <button disabled={loading} onClick={submit} className="w-full rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50">
              {loading ? '분석 중...' : '분석 시작'}
            </button>
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><b>보안 기본값</b><br />외부 접속 웹앱 기준으로 로그인, 파일 비공개 저장, 원본 삭제 옵션을 전제로 설계.</div>
            <McpCard />
          </aside>

          <section className="space-y-6">
            {result ? (
              <>
                <Summary result={result} />
                <SourceOverview result={result} />
                <ParserMeta result={result} />
                <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
                  <ClauseList clauses={clauses} selected={selected} onSelect={setSelected} />
                  {selected && <ClauseDetail clause={selected} mode={result.inputMode} />}
                </div>
              </>
            ) : <EmptyState />}
          </section>
        </div>
      </section>
    </main>
  );
}

function getInputMode(hasUrl: boolean, hasFile: boolean): InputMode {
  if (hasUrl && hasFile) return 'hybrid';
  if (hasUrl) return 'url-only';
  if (hasFile) return 'file-only';
  return 'empty';
}

function ModeGuide({ mode }: { mode: InputMode }) {
  const items = [
    ['url-only', 'URL only', '성신 공개 신구대비표만 분석'],
    ['file-only', 'File only', '업로드 개정안만 분석'],
    ['hybrid', 'URL + file', 'URL=현행 규정, 파일=제안 개정안'],
  ] as const;
  return (
    <div className="grid gap-2 text-xs">
      {items.map(([key, title, desc]) => (
        <div key={key} className={`rounded-xl border p-3 ${mode === key ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'}`}>
          <b>{title}</b><span className="text-gray-500"> · {desc}</span>
        </div>
      ))}
    </div>
  );
}

function Summary({ result }: { result: AnalysisResult }) {
  const s = result.summary;
  return <div className="grid gap-3 md:grid-cols-5">{[['전체', s.total], ['변경', s.changed], ['신설', s.created], ['삭제', s.deleted], ['고위험', s.highRisk]].map(([k, v]) => <div className="card p-4" key={k}><div className="text-sm text-gray-500">{k}</div><div className="text-3xl font-black">{v}</div></div>)}</div>;
}

function SourceOverview({ result }: { result: ExtendedResult }) {
  const modeLabel = result.inputMode === 'hybrid' ? 'URL + file hybrid' : result.inputMode === 'url-only' ? 'URL only' : result.inputMode === 'file-only' ? 'File only' : '입력 모드';
  return (
    <div className="card p-4 text-sm text-gray-700">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <b>입력 모드 · {modeLabel}</b>
        {result.hybridComparisonSummary?.comparedRows !== undefined && <span className="badge bg-blue-50 text-blue-700">비교 행 {result.hybridComparisonSummary.comparedRows}</span>}
      </div>
      {result.inputMode === 'hybrid' && (
        <div className="mb-3 rounded-2xl bg-emerald-50 p-3 text-emerald-950">
          <b>{result.hybridComparisonSummary?.baselineLabel || '기준/현행 규정'}</b> ↔ <b>{result.hybridComparisonSummary?.amendmentLabel || '제안 개정안'}</b>
          <p className="mt-1">{result.hybridComparisonSummary?.summary || '하이브리드 비교 엔진 출력이 있으면 이 영역에 요약을 표시합니다.'}</p>
        </div>
      )}
      {result.sourceMetadata?.length ? <div className="grid gap-3 md:grid-cols-2">{result.sourceMetadata.map((source, index) => <SourceCard source={source} key={`${source.role || 'source'}-${index}`} />)}</div> : null}
    </div>
  );
}

function SourceCard({ source }: { source: SourceMeta }) {
  return (
    <div className="rounded-2xl border bg-white p-3">
      <div className="font-bold">{source.label || source.role || '소스'}</div>
      <div className="mt-1 text-xs text-gray-500">{[source.kind, source.format, source.name].filter(Boolean).join(' · ')}</div>
      {source.url && <div className="mt-1 truncate text-xs text-blue-600">{source.url}</div>}
      <div className="mt-2 text-xs text-gray-600">행 {source.rowCount ?? 0}{source.confidence !== undefined ? ` · 신뢰도 ${Math.round(source.confidence * 100)}%` : ''}</div>
      {source.warnings?.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">{source.warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}
    </div>
  );
}

function ParserMeta({ result }: { result: ExtendedResult }) {
  const warnings = [...(result.parserWarnings || []), ...(result.hybridComparisonSummary?.warnings || [])];
  return <div className="card p-4 text-sm text-gray-700"><b>파싱 정보</b> · {result.sourceFormat}{result.previousHistory && result.currentHistory ? ` · ${result.previousHistory} → ${result.currentHistory}` : ''}{warnings.length ? <ul className="mt-2 list-disc pl-5 text-amber-700">{warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}</div>;
}

function ClauseList({ clauses, selected, onSelect }: { clauses: ClauseAnalysis[]; selected: ClauseAnalysis | null; onSelect: (c: ClauseAnalysis) => void }) {
  return <div className="card overflow-hidden"><div className="border-b p-4 font-bold">조문 목록</div><div className="max-h-[720px] overflow-auto">{clauses.map(c => <button key={c.id} onClick={() => onSelect(c)} className={`block w-full border-b p-4 text-left hover:bg-blue-50 ${selected?.id === c.id ? 'bg-blue-50' : ''}`}><div className="flex items-center justify-between gap-3"><b>{c.article}</b><span className={`badge ${riskClass(c.riskLevel)}`}>{c.riskLevel}</span></div><p className="mt-1 text-sm text-gray-600">{c.summary}</p><p className="mt-2 text-xs text-gray-500">{c.changeType} · 위험점수 {c.riskScore}</p></button>)}</div></div>;
}

function ClauseDetail({ clause, mode }: { clause: ClauseAnalysis; mode?: InputMode }) {
  const diff = useMemo(() => simpleDiff(clause.oldText || '(없음)', clause.newText || '(없음)'), [clause]);
  const oldTitle = mode === 'hybrid' ? '기준/현행 규정' : '구 조문';
  const newTitle = mode === 'hybrid' ? '제안 개정안' : '신 조문';
  return <div className="card p-5 space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">{clause.article}</h2><span className={`badge ${riskClass(clause.riskLevel)}`}>{clause.riskLevel} · {clause.riskScore}</span></div><div className="grid gap-4 md:grid-cols-2"><DiffBox title={oldTitle} html={diff.oldHtml} /><DiffBox title={newTitle} html={diff.newHtml} /></div><Info title="개정 사유" text={clause.reason} /><Info title="변경 요약" text={clause.summary} /><Info title="실무 영향" text={clause.impact} />{clause.riskDrivers?.length ? <div><h3 className="mb-2 font-bold">위험 근거</h3><ul className="list-disc pl-5 text-sm text-gray-700">{clause.riskDrivers.map(driver => <li key={driver}>{driver}</li>)}</ul></div> : null}{clause.legalEvidenceStatus && <Info title="법령 근거 상태" text={`${clause.legalEvidenceStatus}${clause.legalEvidenceReason ? ' · ' + clause.legalEvidenceReason : ''}`} />}<div><h3 className="mb-2 font-bold flex items-center gap-2"><AlertTriangle size={18} /> 확인 질문</h3><ul className="list-disc pl-5 text-sm text-gray-700">{clause.questions.map(q => <li key={q}>{q}</li>)}</ul></div><Info title="검토 의견 초안" text={clause.opinionDraft} />{clause.parserConfidence !== undefined && <Info title="파서 신뢰도" text={`${Math.round(clause.parserConfidence * 100)}%${clause.parserWarnings?.length ? ' · ' + clause.parserWarnings.join(', ') : ''}`} />}<LegalCheckBox clause={clause} /><div className="rounded-2xl bg-slate-50 p-4"><h3 className="mb-2 font-bold flex items-center gap-2"><Gavel size={18} /> 법령/MCP 검토 키워드</h3><div className="flex flex-wrap gap-2">{clause.lawKeywords.map(k => <span className="badge bg-white border" key={k}>{k}</span>)}</div></div></div>;
}

function LegalCheckBox({ clause }: { clause: ClauseAnalysis }) {
  const check = clause.legalCheck;
  if (!check) return null;
  return <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950"><h3 className="mb-2 font-bold flex items-center gap-2"><Gavel size={18} /> 법령 근거 확인 · {check.status}</h3>{check.evidence.length ? <ul className="space-y-2">{check.evidence.map(e => <li key={e.id} className="rounded-xl bg-white p-3"><b>{e.citation}</b><p className="mt-1 text-xs text-gray-600">{e.text}</p></li>)}</ul> : <p>확정 표시 가능한 citation이 없습니다. 근거를 임의 생성하지 않습니다.</p>}{check.warnings.length ? <ul className="mt-2 list-disc pl-5 text-amber-700">{check.warnings.map(w => <li key={w}>{w}</li>)}</ul> : null}</div>;
}

function DiffBox({ title, html }: { title: string; html: string }) { return <div className="rounded-2xl border bg-white p-4"><h3 className="mb-2 font-bold">{title}</h3><p className="diff whitespace-pre-wrap text-sm leading-7" dangerouslySetInnerHTML={{ __html: html }} /></div>; }
function Info({ title, text }: { title: string; text: string }) { return <div><h3 className="mb-2 font-bold">{title}</h3><p className="rounded-2xl bg-gray-50 p-4 text-sm leading-7 text-gray-700">{text}</p></div>; }
function McpCard() { return <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-950"><div className="mb-1 flex items-center gap-2 font-bold"><CheckCircle2 size={18} /> MCP 연동 예정</div><p>Korean Law MCP: 법령 검색/근거 확인<br />Gordon MCP: 문서 추론/체크리스트 생성</p></div>; }
function EmptyState() { return <div className="card p-10 text-center"><FileText className="mx-auto mb-3" size={42} /><h2 className="text-2xl font-black">분석할 대비표를 입력하세요</h2><p className="mt-2 text-gray-600">URL only, file only, URL+file hybrid 세 가지 모드를 지원합니다.</p></div>; }
function riskClass(r: string) { return r === '낮음' ? 'risk-low' : r === '보통' ? 'risk-medium' : r === '높음' ? 'risk-high' : 'risk-critical'; }
