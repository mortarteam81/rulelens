# Hybrid URL + Upload Regression Plan

Wave 2 QA target: keep the dashboard safe when a public Sungshin baseline URL and a user-uploaded amendment are analyzed together.

## Expected hybrid behavior

1. A `sourceUrl` may provide baseline/current public regulation context.
2. An uploaded HWP/HWPX/PDF/TXT amendment may provide the proposed change rows.
3. If the upload already contains a 신구조문 대비표 with old/new columns, the upload rows should be preserved as the primary comparison rows instead of being diffed again blindly.
4. Parser confidence is not the same as content risk:
   - low confidence should surface parser warnings and require manual confirmation;
   - high-risk wording such as `반드시`, `하여야`, `제출`, `승인`, `심의`, `삭제`, or `신설` must still be reviewed even when parser confidence is high or low.
5. Duplicate or long `별표` rows must not be deduplicated, truncated, or collapsed unless a later explicit row-grouping step records provenance.

## Regression matrix

| Case | Fixture shape | Assertions |
| --- | --- | --- |
| Baseline URL + uploaded amendment | multipart request with `sourceUrl` and `file` | response uses URL metadata when available, but clauses include uploaded amendment rows and parser warnings from both sources |
| Uploaded 대비표 already has old/new columns | TSV/object rows with `구 조문`, `신 조문`, `개정사유` | normalized rows keep old/new text, reason, article, and confidence |
| Parser confidence vs content risk | malformed/missing article row with mandatory-duty wording | low confidence/warnings remain visible; content-risk smoke flags row for review |
| Duplicate/long 별표 rows | repeated `별표 1` article with long old/new text | both rows remain separate and long content is retained |

## How to run

```bash
npm run test:hybrid-regression
```

Optional API smoke against a running app:

```bash
HYBRID_ANALYZE_URL=http://localhost:3000/api/analyze npm run test:hybrid-regression
```

The API smoke is intentionally skipped when `HYBRID_ANALYZE_URL` is unset so the module-level checks can run in CI without a server.
