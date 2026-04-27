# Upload Parser Boundaries

## HWPX
- Implemented in `lib/parsers/hwpx.ts`.
- Uses `jszip` to read the HWPX package and `fast-xml-parser` to inspect `Contents/section*.xml`.
- Extracts table rows first, then maps likely 신구조문 columns to `ParsedComparisonRow`.
- If no table rows are identifiable, falls back to low-confidence body text extraction with parser warnings.

## Legacy HWP
- Implemented in `lib/parsers/hwp.ts` as a safe adapter boundary.
- Uses a local `hwp5txt` or `pyhwp` command only when it is already available on `PATH`.
- If neither command exists, it returns an empty `ParsedComparisonTable` with clear warnings instead of pretending to parse the file.
- Current adapter converts HWP to text and then extracts article-like sections with low confidence because legacy HWP table/cell boundaries depend on the sidecar converter.

## PDF
- Implemented in `lib/parsers/pdf.ts` as a server-side adapter boundary.
- Uses JS `pdf-parse` through `scripts/extract-pdf-text.mjs` child-process adapter for minimal text/page extraction. The child-process boundary avoids bundling issues with PDF.js workers in Next server routes.
- Falls back to `scripts/extract-pdf-text.py`, which tries PyMuPDF (`fitz`) and then `pdfplumber` if those tools are available on the host.
- Normalizes extracted text with low-confidence Korean 신구조문 대비표 heuristics. PDF table cell boundaries are inherently lossy, so rows always carry parser warnings.
- Validated against `fixtures/uploads/raw/2026-1st-temporary-regulation-committee-materials.pdf` for meaningful Korean text and the 별표Ⅰ 입학정원표 comparison block.

## kordoc CLI/MCP adapter boundary
- Implemented in `lib/parsers/kordoc-adapter.ts` as an optional augmentation layer, not a hard dependency.
- Role: kordoc can parse HWP/HWPX/PDF/XLSX/DOCX into Markdown, preserve complex tables better than local heuristics, and expose MCP tools such as `parse_document`, `parse_table`, and document comparison. In this app it is treated as a sidecar parser whose output must still pass through regdiff normalization and warnings.
- Safe detection only: the adapter checks an already-available local `npx --no-install kordoc --version`, or notices future MCP hints via `KORDOC_MCP_COMMAND`/`KORDOC_MCP_URL`. It never runs `kordoc setup`, installs packages, or patches Claude/Cursor/MCP client config.
- `parse_document`: when local kordoc is available, writes the upload to a temp file and calls `npx --no-install kordoc <file>`, returning Markdown plus warnings. When unavailable, returns `ok: false` with actionable warnings so HWPX/HWP/PDF fallbacks continue.
- `parse_table`: calls `parse_document`, then feeds kordoc Markdown tables into `normalizeComparisonTable`. This can replace or augment current HWP/PDF table heuristics once fixture quality proves better.
- `compare_documents`: boundary is defined for future MCP/CLI schema integration, but currently returns a graceful warning and leaves comparison to the existing hybrid pipeline. Once kordoc's stable tool contract is chosen, previous/current documents can be routed here.

## Still missing / intentionally deferred
- OCR/scanned document handling is out of MVP scope.
- Legacy HWP support requires installing a converter such as pyhwp/hwp5txt on the deployment host, or enabling kordoc sidecar/MCP separately.
- PDF extraction quality depends on embedded text quality; complex tables may require HWPX/HWP source or a dedicated table extraction pass such as kordoc.
- Direct MCP transport for kordoc is intentionally deferred; do not modify user MCP client configuration from this app.
