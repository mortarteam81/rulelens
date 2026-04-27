import type { AnalysisResult, ClauseAnalysis } from '@/lib/types';
import { accreditationDictionary } from './accreditation-dictionary';
import { departmentDictionary } from './department-dictionary';
import { indicatorDictionary } from './indicator-dictionary';
import {
  calculateFinalImpactScore,
  calculateRelevanceScore,
  collectMatchedKeywords,
  impactLevelFromScore,
  relevanceLevel,
} from './scoring';
import type {
  AccreditationMapping,
  DepartmentMapping,
  FollowUpAction,
  IrExtendedAnalysisResult,
  IrExtendedClauseAnalysis,
  IrIndicatorMapping,
} from './types';

export function enrichWithIrMappings(result: AnalysisResult): IrExtendedAnalysisResult {
  const clauses = result.clauses.map(enrichClause);
  const topFollowUpActions = clauses
    .flatMap((clause) => clause.followUpActions)
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
    .slice(0, 8);

  return {
    ...result,
    schemaVersion: 'rulelens.ir-analysis.v1',
    irSummary: {
      mappedClauses: clauses.filter((clause) => hasAnyMapping(clause)).length,
      highImpactClauses: clauses.filter((clause) => clause.finalImpactLevel === '높음' || clause.finalImpactLevel === '매우 높음').length,
      impactedIndicators: unique(clauses.flatMap((clause) => clause.irMappings.map((mapping) => mapping.targetName))),
      impactedAccreditationStandards: unique(clauses.flatMap((clause) => clause.accreditationMappings.map((mapping) => mapping.targetName))),
      impactedDepartments: unique(clauses.flatMap((clause) => clause.departmentMappings.map((mapping) => mapping.targetName))),
      topFollowUpActions,
    },
    clauses,
  };
}

function enrichClause(clause: ClauseAnalysis): IrExtendedClauseAnalysis {
  const text = buildClauseText(clause);
  const irMappings = buildIndicatorMappings(text, clause);
  const accreditationMappings = buildAccreditationMappings(text, clause);
  const departmentMappings = buildDepartmentMappings(text, clause);
  const finalImpactScore = calculateFinalImpactScore({
    rulelensRiskScore: clause.riskScore,
    irMappingScores: irMappings.map((mapping) => mapping.relevanceScore),
    accreditationScores: accreditationMappings.map((mapping) => mapping.relevanceScore),
    departmentScores: departmentMappings.map((mapping) => mapping.relevanceScore),
    legalStatus: clause.legalCheck?.status,
  });
  const finalImpactLevel = impactLevelFromScore(finalImpactScore);

  return {
    ...clause,
    irMappings,
    accreditationMappings,
    departmentMappings,
    finalImpactScore,
    finalImpactLevel,
    followUpActions: buildFollowUpActions({ clause, irMappings, accreditationMappings, departmentMappings, finalImpactLevel }),
  };
}

function buildIndicatorMappings(text: string, clause: ClauseAnalysis): IrIndicatorMapping[] {
  return indicatorDictionary
    .map((entry) => {
      const matchedKeywords = collectMatchedKeywords(text, entry.keywords);
      const relevanceScore = calculateRelevanceScore(entry, matchedKeywords, clause.riskScore);
      if (!matchedKeywords.length || relevanceScore < 35) return undefined;
      return {
        mappingType: entry.mappingType,
        targetId: entry.id,
        targetName: entry.name,
        source: entry.source,
        relevanceScore,
        relevanceLevel: relevanceLevel(relevanceScore),
        matchedKeywords,
        mappingReason: `${matchedKeywords.join(', ')} 키워드가 조문 변경 내용 또는 검토의견에서 감지되어 ${entry.source} 지표와 연결했습니다.`,
      } satisfies IrIndicatorMapping;
    })
    .filter((mapping): mapping is IrIndicatorMapping => Boolean(mapping))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function buildAccreditationMappings(text: string, clause: ClauseAnalysis): AccreditationMapping[] {
  return accreditationDictionary
    .map((entry) => {
      const matchedKeywords = collectMatchedKeywords(text, entry.keywords);
      const relevanceScore = calculateRelevanceScore(entry, matchedKeywords, clause.riskScore);
      if (!matchedKeywords.length || relevanceScore < 35) return undefined;
      return {
        mappingType: 'accreditation',
        targetId: entry.id,
        targetName: entry.name,
        cycle: entry.cycle,
        standardCode: entry.standardCode,
        relevanceScore,
        relevanceLevel: relevanceLevel(relevanceScore),
        matchedKeywords,
        mappingReason: `${matchedKeywords.join(', ')} 키워드가 4주기 평가인증 영향 영역과 연결됩니다.`,
      } satisfies AccreditationMapping;
    })
    .filter((mapping): mapping is AccreditationMapping => Boolean(mapping))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function buildDepartmentMappings(text: string, clause: ClauseAnalysis): DepartmentMapping[] {
  return departmentDictionary
    .map((entry) => {
      const matchedKeywords = collectMatchedKeywords(text, entry.keywords);
      const relevanceScore = calculateRelevanceScore(entry, matchedKeywords, clause.riskScore);
      if (!matchedKeywords.length || relevanceScore < 35) return undefined;
      return {
        mappingType: 'department',
        targetId: entry.id,
        targetName: entry.name,
        role: entry.role,
        relevanceScore,
        relevanceLevel: relevanceLevel(relevanceScore),
        matchedKeywords,
        mappingReason: `${matchedKeywords.join(', ')} 키워드가 담당 업무 범위와 연결됩니다.`,
      } satisfies DepartmentMapping;
    })
    .filter((mapping): mapping is DepartmentMapping => Boolean(mapping))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 4);
}

function buildFollowUpActions(input: {
  clause: ClauseAnalysis;
  irMappings: IrIndicatorMapping[];
  accreditationMappings: AccreditationMapping[];
  departmentMappings: DepartmentMapping[];
  finalImpactLevel: IrExtendedClauseAnalysis['finalImpactLevel'];
}): FollowUpAction[] {
  const ownerDepartment = input.departmentMappings[0]?.targetName;
  const actions: FollowUpAction[] = [];

  if (input.irMappings.length) {
    actions.push({
      priority: input.finalImpactLevel,
      ownerDepartment,
      action: `관련 IR/공시 지표 영향 확인: ${input.irMappings.slice(0, 3).map((mapping) => mapping.targetName).join(', ')}`,
      reason: `${input.clause.article} 변경이 지표 산식, 입력자료, 공시값 또는 내부 관리지표에 영향을 줄 수 있습니다.`,
    });
  }

  if (input.accreditationMappings.length) {
    actions.push({
      priority: input.finalImpactLevel,
      ownerDepartment: ownerDepartment ?? '기획평가팀',
      action: `4주기 평가인증 영향 검토: ${input.accreditationMappings.slice(0, 2).map((mapping) => mapping.targetName).join(', ')}`,
      reason: '규정 변경이 자체진단 근거자료, 운영체계, 지표 해석에 반영되어야 할 수 있습니다.',
    });
  }

  if (input.departmentMappings.length) {
    actions.push({
      priority: input.finalImpactLevel,
      ownerDepartment,
      action: `담당부서 검토 요청: ${input.departmentMappings.slice(0, 3).map((mapping) => mapping.targetName).join(', ')}`,
      reason: '규정 문구와 실제 업무 수행 가능성, 권한, 일정, 증빙자료 관리 방식을 확인해야 합니다.',
    });
  }

  if (!actions.length && (input.clause.riskLevel === '높음' || input.clause.riskLevel === '매우 높음')) {
    actions.push({
      priority: input.clause.riskLevel,
      action: '고위험 조문 수동 검토',
      reason: 'IR 매핑 사전에는 직접 연결되지 않았지만 RuleLens 위험도가 높아 담당자 확인이 필요합니다.',
    });
  }

  return actions;
}

function buildClauseText(clause: ClauseAnalysis): string {
  return [
    clause.article,
    clause.oldText,
    clause.newText,
    clause.reason,
    clause.changeType,
    clause.summary,
    clause.impact,
    clause.opinionDraft,
    ...(clause.questions ?? []),
    ...(clause.riskDrivers ?? []),
    ...(clause.lawKeywords ?? []),
  ].filter(Boolean).join('\n');
}

function hasAnyMapping(clause: IrExtendedClauseAnalysis): boolean {
  return Boolean(clause.irMappings.length || clause.accreditationMappings.length || clause.departmentMappings.length);
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean).slice(0, 20);
}

function priorityRank(level: FollowUpAction['priority']): number {
  if (level === '매우 높음') return 4;
  if (level === '높음') return 3;
  if (level === '보통') return 2;
  return 1;
}
