import type { AnalysisResult, ClauseAnalysis, RiskLevel } from '@/lib/types';

export type IrMappingType = 'disclosure' | 'internal-ir' | 'accreditation' | 'department';
export type IrImpactLevel = RiskLevel;

export type DictionaryEntry = {
  id: string;
  name: string;
  keywords: string[];
  description?: string;
  source?: string;
  weight?: number;
};

export type IndicatorDictionaryEntry = DictionaryEntry & {
  mappingType: 'disclosure' | 'internal-ir';
  source: string;
};

export type AccreditationDictionaryEntry = DictionaryEntry & {
  cycle: string;
  standardCode: string;
};

export type DepartmentDictionaryEntry = DictionaryEntry & {
  role: string;
};

export type BaseMapping = {
  mappingType: IrMappingType;
  targetId: string;
  targetName: string;
  relevanceScore: number;
  relevanceLevel: IrImpactLevel;
  matchedKeywords: string[];
  mappingReason: string;
};

export type IrIndicatorMapping = BaseMapping & {
  mappingType: 'disclosure' | 'internal-ir';
  source: string;
};

export type AccreditationMapping = BaseMapping & {
  mappingType: 'accreditation';
  cycle: string;
  standardCode: string;
};

export type DepartmentMapping = BaseMapping & {
  mappingType: 'department';
  role: string;
};

export type FollowUpAction = {
  priority: IrImpactLevel;
  ownerDepartment?: string;
  action: string;
  reason: string;
};

export type IrExtendedClauseAnalysis = ClauseAnalysis & {
  irMappings: IrIndicatorMapping[];
  accreditationMappings: AccreditationMapping[];
  departmentMappings: DepartmentMapping[];
  finalImpactScore: number;
  finalImpactLevel: IrImpactLevel;
  followUpActions: FollowUpAction[];
};

export type IrImpactSummary = {
  mappedClauses: number;
  highImpactClauses: number;
  impactedIndicators: string[];
  impactedAccreditationStandards: string[];
  impactedDepartments: string[];
  topFollowUpActions: FollowUpAction[];
};

export type IrExtendedAnalysisResult = Omit<AnalysisResult, 'clauses'> & {
  schemaVersion: 'rulelens.ir-analysis.v1';
  irSummary: IrImpactSummary;
  clauses: IrExtendedClauseAnalysis[];
};
