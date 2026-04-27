import type { RiskLevel } from '@/lib/types';
import type { DictionaryEntry, IrImpactLevel } from './types';

export function collectMatchedKeywords(text: string, keywords: string[]): string[] {
  const compact = normalizeForMatch(text);
  return keywords.filter((keyword) => compact.includes(normalizeForMatch(keyword)));
}

export function calculateRelevanceScore(entry: DictionaryEntry, matchedKeywords: string[], baseRiskScore: number): number {
  if (!matchedKeywords.length) return 0;
  const keywordCoverage = matchedKeywords.length / Math.max(entry.keywords.length, 1);
  const keywordScore = Math.min(55, matchedKeywords.length * 14 + keywordCoverage * 20);
  const weightScore = entry.weight ?? 10;
  const riskBonus = baseRiskScore >= 80 ? 15 : baseRiskScore >= 65 ? 10 : baseRiskScore >= 45 ? 5 : 0;
  return clampScore(Math.round(keywordScore + weightScore + riskBonus));
}

export function relevanceLevel(score: number): IrImpactLevel {
  if (score >= 85) return '매우 높음';
  if (score >= 70) return '높음';
  if (score >= 45) return '보통';
  return '낮음';
}

export function calculateFinalImpactScore(input: {
  rulelensRiskScore: number;
  irMappingScores: number[];
  accreditationScores: number[];
  departmentScores: number[];
  legalStatus?: string;
}): number {
  const maxIr = Math.max(0, ...input.irMappingScores);
  const maxAccreditation = Math.max(0, ...input.accreditationScores);
  const departmentBreadth = Math.min(10, input.departmentScores.filter((score) => score >= 45).length * 3);
  const legalBonus = input.legalStatus === '충돌 가능성 있음' ? 12 : input.legalStatus === '추가 확인 필요' ? 7 : input.legalStatus === '근거 미확인' ? 4 : 0;
  return clampScore(Math.round(input.rulelensRiskScore + maxIr * 0.18 + maxAccreditation * 0.18 + departmentBreadth + legalBonus));
}

export function impactLevelFromScore(score: number): RiskLevel {
  if (score >= 85) return '매우 높음';
  if (score >= 70) return '높음';
  if (score >= 50) return '보통';
  return '낮음';
}

export function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[\s\n\r\t「」『』()（）\[\]{}<>.,，。ㆍ․·･:：;；\-_/]/g, '');
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
