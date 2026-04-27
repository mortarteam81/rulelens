import { z } from 'zod';

export const LegalEvidenceStatusSchema = z.enum([
  'evidence_verified',
  'needs_human_review',
  'missing_evidence',
]);

export const AiReviewModeSchema = z.enum(['deterministic_fallback', 'ai_assisted']);

export const LegalCitationSchema = z.object({
  source: z.string().min(1),
  title: z.string().min(1),
  article: z.string().optional(),
  url: z.string().url().optional(),
  retrievedAt: z.string().optional(),
  quote: z.string().optional(),
  verified: z.boolean(),
});

export const ClauseRiskReviewSchema = z.object({
  riskScore: z.number().int().min(0).max(100),
  riskDrivers: z.array(z.string().min(1)),
  practicalImpact: z.string().min(1),
  reviewQuestions: z.array(z.string().min(1)).min(1),
  opinionDraft: z.string().min(1),
});

export const ClauseLegalEvidenceSchema = z.object({
  status: LegalEvidenceStatusSchema,
  citations: z.array(LegalCitationSchema),
  missingEvidenceReason: z.string().optional(),
  unsupportedCitationWarnings: z.array(z.string()),
});

export const ClauseAiReviewSchema = z.object({
  schemaVersion: z.literal('clause-review.v1'),
  mode: AiReviewModeSchema,
  changeType: z.string().min(1),
  risk: ClauseRiskReviewSchema,
  legalEvidence: ClauseLegalEvidenceSchema,
  guardrails: z.object({
    noFinalLegalAdvice: z.literal(true),
    noUnsupportedLawCitations: z.literal(true),
    humanReviewRequired: z.literal(true),
    disclaimer: z.string().min(1),
  }),
  modelInfo: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

export const ClauseAiReviewArraySchema = z.array(ClauseAiReviewSchema);

export type LegalEvidenceStatus = z.infer<typeof LegalEvidenceStatusSchema>;
export type LegalCitation = z.infer<typeof LegalCitationSchema>;
export type ClauseAiReview = z.infer<typeof ClauseAiReviewSchema>;
