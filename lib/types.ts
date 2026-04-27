import type { ClauseAiReview, LegalEvidenceStatus } from './ai-review/schemas';
import type { LegalCheckResult } from './mcp/korean-law-client';

export type RiskLevel='낮음'|'보통'|'높음'|'매우 높음';
export type ChangeType='문구 정비'|'용어 변경'|'변경'|'절차 변경'|'권한/책임 변경'|'기준/요건 변경'|'신설'|'삭제'|'상위법령 반영 의심';
export type InputMode='url-only'|'file-only'|'hybrid'|'empty';
export type SourceMetadata={role?:'baseline'|'amendment'|'analysis'|string;label?:string;kind?:string;format?:string;name?:string;url?:string;rowCount?:number;confidence?:number;warnings?:string[]};
export type HybridComparisonSummary={mode?:string;baselineLabel?:string;amendmentLabel?:string;comparedRows?:number;summary?:string;warnings?:string[]};
export type ClauseAnalysis={id:string;article:string;oldText:string;newText:string;reason:string;changeType:ChangeType;riskLevel:RiskLevel;riskScore:number;summary:string;impact:string;questions:string[];opinionDraft:string;lawKeywords:string[];legalEvidenceStatus?:LegalEvidenceStatus;legalEvidenceReason?:string;legalCheck?:LegalCheckResult;riskDrivers?:string[];aiReviewMode?:ClauseAiReview['mode'];aiReview?:ClauseAiReview;parserConfidence?:number;parserWarnings?:string[]};
export type AnalysisResult={regulationName:string;purpose:string;sourceFormat:string;inputMode?:InputMode;sourceMetadata?:SourceMetadata[];hybridComparisonSummary?:HybridComparisonSummary;previousHistory?:string;currentHistory?:string;parserWarnings?:string[];summary:{total:number;changed:number;created:number;deleted:number;highRisk:number;topFindings:string[]};clauses:ClauseAnalysis[]};
