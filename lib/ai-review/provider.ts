import type { ParsedComparisonRow } from '../parsers/types';
import type { ChangeType } from '../types';
import type { ClauseAiReview } from './schemas';
import { buildDeterministicClauseReview } from './fallback';

export type AiClauseReviewRequest = {
  row: ParsedComparisonRow;
  changeType: ChangeType;
  riskScore: number;
  lawKeywords: string[];
};

export type AiClauseReviewProvider = {
  name: string;
  reviewClause(request: AiClauseReviewRequest): Promise<ClauseAiReview>;
};

export async function reviewClauseWithOptionalAi(
  request: AiClauseReviewRequest,
  provider?: AiClauseReviewProvider,
): Promise<ClauseAiReview> {
  if (!provider) return buildDeterministicClauseReview(request);

  const review = await provider.reviewClause(request);
  if (review.guardrails.noFinalLegalAdvice !== true || review.guardrails.noUnsupportedLawCitations !== true) {
    throw new Error(`AI review provider ${provider.name} returned review without required legal guardrails`);
  }
  return review;
}
