# Wave 3 AI + MCP Regression Plan

Wave 3 adds an AI-assisted review layer plus Korean Law MCP and kordoc MCP evidence lookup. The QA baseline is: the app must stay deterministic and conservative when those services are absent, slow, or incomplete.

## Required safety contracts

1. **Deterministic mode without LLM**
   - The analyzer must be runnable with no LLM key and no MCP server.
   - In this mode every clause review uses `mode: 'deterministic_fallback'`.
   - `modelInfo` may be omitted; the UI must not imply that an LLM reviewed the clause.

2. **No invented citations**
   - A legal citation may be displayed as evidence only when it came from Korean Law MCP or another explicit evidence source and is marked `verified: true`.
   - If a model suggests a statute/article name without retrieved evidence, keep it as a keyword or review question, not as a citation.
   - `legalEvidence.status` must not be `evidence_verified` when citations are empty or unverified.

3. **Missing evidence status**
   - When evidence retrieval is not run or finds nothing, use `legalEvidence.status: 'missing_evidence'` and fill `missingEvidenceReason`.
   - The UI copy should say “근거 확인 필요” or equivalent, not “위반/적법 확정”.

4. **kordoc unavailable warning**
   - If kordoc MCP is unavailable, preserve a visible warning such as `kordoc MCP unavailable: evidence retrieval skipped`.
   - Korean Law MCP evidence and kordoc document reasoning are separate; one unavailable tool must not silently downgrade or fabricate the other.

5. **Parser confidence vs legal risk separation**
   - `parserConfidence` and `parserWarnings` describe extraction quality only.
   - `riskScore`, `riskDrivers`, and `legalEvidence.status` describe content/legal review only.
   - Low parser confidence should require manual confirmation, but it must not suppress high-risk wording such as `반드시`, `하여야`, `제출`, `승인`, `심의`, `삭제`, or `신설`.

## Regression matrix

| Case | Setup | Must assert |
| --- | --- | --- |
| Deterministic fallback | No LLM/MCP env or clients disabled | valid review object with `mode: deterministic_fallback`, no `modelInfo`, guardrails true |
| No invented citations | AI/MCP layer returns keywords but no retrieved citation | no displayed `verified` citation; status is `missing_evidence` or `needs_human_review` |
| Missing Korean Law evidence | Korean Law MCP returns no match | `missingEvidenceReason` present and human review required |
| kordoc unavailable | kordoc MCP connection fails or disabled | warning is preserved in `unsupportedCitationWarnings` or clause warnings |
| Parser confidence separation | malformed row with mandatory-duty wording | low parser confidence remains visible and content risk still flags review |

## Manual review notes

- Treat AI output as drafting assistance only. It can summarize, classify, and draft questions/opinions; it must not make final legal determinations.
- Korean Law MCP citations are the only source that can upgrade a law basis to verified evidence.
- kordoc MCP may support practical document reasoning, but it is not a substitute for verified law citations.
