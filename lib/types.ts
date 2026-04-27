export type RiskLevel='낮음'|'보통'|'높음'|'매우 높음';
export type ChangeType='문구 정비'|'용어 변경'|'절차 변경'|'권한/책임 변경'|'기준/요건 변경'|'신설'|'삭제'|'상위법령 반영 의심';
export type ClauseAnalysis={id:string;article:string;oldText:string;newText:string;reason:string;changeType:ChangeType;riskLevel:RiskLevel;riskScore:number;summary:string;impact:string;questions:string[];opinionDraft:string;lawKeywords:string[]};
export type AnalysisResult={regulationName:string;purpose:string;sourceFormat:string;summary:{total:number;changed:number;created:number;deleted:number;highRisk:number;topFindings:string[]};clauses:ClauseAnalysis[]};
