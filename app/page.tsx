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
                <PracticalReviewBoard result={result} clauses={clauses} selected={selected} onSelect={setSelected} />
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
  return <div className="card p-4 text-sm text-gray-700"><div className="flex flex-wrap items-center justify-between gap-2"><b>파싱 정보</b><span className="badge bg-slate-50 text-slate-700">{result.sourceFormat}{result.previousHistory && result.currentHistory ? ` · ${result.previousHistory} → ${result.currentHistory}` : ''}</span></div>{warnings.length ? <details className="mt-3 rounded-2xl bg-amber-50 p-3 text-amber-900"><summary className="cursor-pointer font-bold">파싱 참고사항 {warnings.length}건</summary><ul className="mt-2 list-disc pl-5 text-xs leading-6">{warnings.map(w => <li key={w}>{w}</li>)}</ul></details> : null}</div>;
}

type ClauseGroup = { title: string; subtitle: string; clauses: ClauseAnalysis[] };

function PracticalReviewBoard({ result, clauses, selected, onSelect }: { result: ExtendedResult; clauses: ClauseAnalysis[]; selected: ClauseAnalysis | null; onSelect: (c: ClauseAnalysis) => void }) {
  const groups = useMemo(() => buildClauseGroups(clauses), [clauses]);
  return <div className="space-y-6"><ReviewBrief result={result} groups={groups} />{groups.map((group, index) => <AgendaGroup key={`${group.title}-${index}`} group={group} index={index} selected={selected} onSelect={onSelect} mode={result.inputMode} />)}{selected && <ClauseDetail clause={selected} mode={result.inputMode} />}</div>;
}

function ReviewBrief({ result, groups }: { result: ExtendedResult; groups: ClauseGroup[] }) {
  const highRisk = result.clauses.filter(clause => clause.riskLevel === '높음' || clause.riskLevel === '매우 높음').length;
  const lowConfidence = result.clauses.filter(clause => (clause.parserConfidence ?? 1) < 0.75).length;
  return <div className="card overflow-hidden"><div className="border-b bg-slate-950 p-5 text-white"><p className="text-xs font-bold uppercase tracking-[0.25em] text-blue-200">Practical Review Brief</p><h2 className="mt-1 text-2xl font-black">실무 검토 요약</h2><p className="mt-2 text-sm text-slate-300">안건별로 변경내용, 비고, 검토의견을 한 화면에서 확인합니다.</p></div><div className="grid gap-3 p-4 md:grid-cols-4"><Metric label="안건" value={groups.length} tone="slate" /><Metric label="검토 row" value={result.clauses.length} tone="blue" /><Metric label="내용 고위험" value={highRisk} tone="red" /><Metric label="파서 확인필요" value={lowConfidence} tone="amber" /></div>{result.summary.topFindings?.length ? <div className="border-t p-4"><b className="text-sm">주요 확인 포인트</b><ul className="mt-2 grid gap-2 text-sm text-gray-700">{result.summary.topFindings.slice(0, 4).map(finding => <li key={finding} className="rounded-xl bg-gray-50 p-3">{finding}</li>)}</ul></div> : null}</div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'slate' | 'blue' | 'red' | 'amber' }) {
  const toneClass = tone === 'red' ? 'bg-red-50 text-red-700' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : tone === 'blue' ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-700';
  return <div className={`rounded-2xl p-4 ${toneClass}`}><div className="text-xs font-bold opacity-70">{label}</div><div className="mt-1 text-3xl font-black">{value}</div></div>;
}

function AgendaGroup({ group, index, selected, onSelect, mode }: { group: ClauseGroup; index: number; selected: ClauseAnalysis | null; onSelect: (c: ClauseAnalysis) => void; mode?: InputMode }) {
  return <details open className="card overflow-hidden"><summary className="cursor-pointer border-b bg-white p-5"><div className="inline-flex w-full flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-blue-600">안건 {index + 1}</p><h3 className="text-xl font-black">{group.title}</h3><p className="mt-1 text-sm text-gray-600">{group.subtitle}</p></div><div className="flex gap-2 text-xs"><span className="badge bg-slate-50 text-slate-700">{group.clauses.length}개 row</span><span className="badge bg-red-50 text-red-700">고위험 {group.clauses.filter(c => c.riskLevel === '높음' || c.riskLevel === '매우 높음').length}</span></div></div></summary><div className="overflow-x-auto"><table className="w-full min-w-[980px] border-collapse text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-[190px] p-3">조문/상태</th><th className="w-[24%] p-3">{mode === 'hybrid' ? '기준/현행 규정' : '현행'}</th><th className="w-[24%] p-3">{mode === 'hybrid' ? '제안 개정안' : '개정(안)'}</th><th className="p-3">비고 / 검토의견</th></tr></thead><tbody>{group.clauses.map(clause => <ReviewRow key={clause.id} clause={clause} selected={selected?.id === clause.id} onSelect={onSelect} />)}</tbody></table></div></details>;
}

function ReviewRow({ clause, selected, onSelect }: { clause: ClauseAnalysis; selected: boolean; onSelect: (c: ClauseAnalysis) => void }) {
  return <tr onClick={() => onSelect(clause)} className={`cursor-pointer border-t align-top hover:bg-blue-50/60 ${selected ? 'bg-blue-50' : 'bg-white'}`}><td className="p-3"><b className="block text-slate-950">{clause.article}</b><div className="mt-2 flex flex-wrap gap-1"><span className={`badge ${riskClass(clause.riskLevel)}`}>{clause.riskLevel} {clause.riskScore}</span><span className="badge bg-white border text-slate-600">{clause.changeType}</span></div><div className="mt-2 text-xs text-slate-500">파서 신뢰도 {clause.parserConfidence !== undefined ? `${Math.round(clause.parserConfidence * 100)}%` : '미표시'}</div></td><td className="p-3"><ClampedText text={clause.oldText || '(없음)'} /></td><td className="p-3"><ClampedText text={clause.newText || '(없음)'} /></td><td className="p-3"><div className="rounded-xl bg-slate-50 p-3"><b className="text-xs text-slate-500">변경 요약</b><p className="mt-1 leading-6 text-slate-800">{clause.summary}</p></div><div className="mt-2 rounded-xl bg-amber-50 p-3 text-amber-950"><b className="text-xs">비고/사유</b><p className="mt-1 line-clamp-3 leading-6">{clause.reason}</p></div><div className="mt-2 rounded-xl bg-blue-50 p-3 text-blue-950"><b className="text-xs">검토의견 초안</b><p className="mt-1 line-clamp-4 leading-6">{clause.opinionDraft}</p></div></td></tr>;
}

function ClampedText({ text }: { text: string }) {
  return <p className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border bg-white p-3 text-xs leading-6 text-slate-700">{text}</p>;
}

function buildClauseGroups(clauses: ClauseAnalysis[]): ClauseGroup[] {
  const groups: ClauseAnalysis[][] = [];
  let current: ClauseAnalysis[] = [];
  clauses.forEach(clause => {
    current.push(clause);
    if (/부\s*칙/.test(clause.article)) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length) groups.push(current);
  return groups.map((items, index) => ({ title: inferAgendaTitle(items, index), subtitle: inferAgendaSubtitle(items), clauses: items }));
}

function inferAgendaTitle(clauses: ClauseAnalysis[], index: number): string {
  const text = clauses.map(c => `${c.article} ${c.summary} ${c.reason}`).join(' ');
  if (/교원업적평가|연구영역|필수업적|공동지도교수/.test(text)) return '교원업적평가 규정 개정(안)';
  if (/기금운용심의회|외부전문가|사립학교법/.test(text)) return '기금운용심의회 규정 개정(안)';
  if (/연구산학협력단|단장|2년 미만/.test(text)) return '연구산학협력단 정관 개정(안)';
  return `안건 ${index + 1}`;
}

function inferAgendaSubtitle(clauses: ClauseAnalysis[]): string {
  const high = clauses.filter(c => c.riskLevel === '높음' || c.riskLevel === '매우 높음').length;
  return `조문/별표/부칙 ${clauses.length}개 · 내용 고위험 ${high}개 · 파서 평균 ${averageParserConfidence(clauses)}`;
}

function averageParserConfidence(clauses: ClauseAnalysis[]): string {
  const values = clauses.map(c => c.parserConfidence).filter((v): v is number => typeof v === 'number');
  if (!values.length) return '미표시';
  return `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100)}%`;
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
function McpCard() { return <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-950"><div className="mb-1 flex items-center gap-2 font-bold"><CheckCircle2 size={18} /> MCP 연동 예정</div><p>Korean Law MCP: 법령 검색/근거 확인<br />kordoc MCP: 문서 파싱/표 추출/문서 비교</p></div>; }
function EmptyState() { return <div className="card p-10 text-center"><FileText className="mx-auto mb-3" size={42} /><h2 className="text-2xl font-black">분석할 대비표를 입력하세요</h2><p className="mt-2 text-gray-600">URL only, file only, URL+file hybrid 세 가지 모드를 지원합니다.</p></div>; }
function riskClass(r: string) { return r === '낮음' ? 'risk-low' : r === '보통' ? 'risk-medium' : r === '높음' ? 'risk-high' : 'risk-critical'; }
