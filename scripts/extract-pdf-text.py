#!/usr/bin/env python3
"""Server-side PDF text extraction adapter for regdiff-dashboard.

Outputs JSON only. Tries PyMuPDF first, then pdfplumber. This script is intentionally
small and deterministic; OCR/scanned PDF handling is out of MVP scope.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def emit(payload: dict[str, Any], status: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(status)


def extract_with_pymupdf(pdf_path: Path) -> dict[str, Any]:
    import fitz  # type: ignore[import-not-found]

    pages: list[dict[str, Any]] = []
    warnings: list[str] = []
    with fitz.open(pdf_path) as document:
        if document.is_encrypted:
            warnings.append('PDF가 암호화되어 있습니다. 암호 없는 파일만 지원합니다.')
        for index, page in enumerate(document, start=1):
            text = page.get_text('text') or ''
            pages.append({'page': index, 'text': text})
    return {'ok': True, 'engine': 'pymupdf', 'pages': pages, 'warnings': warnings}


def extract_with_pdfplumber(pdf_path: Path) -> dict[str, Any]:
    import pdfplumber  # type: ignore[import-not-found]

    pages: list[dict[str, Any]] = []
    with pdfplumber.open(str(pdf_path)) as document:
        for index, page in enumerate(document.pages, start=1):
            text = page.extract_text() or ''
            pages.append({'page': index, 'text': text})
    return {'ok': True, 'engine': 'pdfplumber', 'pages': pages, 'warnings': []}


def main() -> None:
    if len(sys.argv) != 2:
        emit({'ok': False, 'error': 'usage', 'warnings': ['Usage: extract-pdf-text.py <pdf-path>']}, status=2)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        emit({'ok': False, 'error': 'file-not-found', 'warnings': [f'PDF 파일을 찾지 못했습니다: {pdf_path}']}, status=2)

    dependency_errors: list[str] = []
    runtime_errors: list[str] = []

    for extractor in (extract_with_pymupdf, extract_with_pdfplumber):
        try:
            emit(extractor(pdf_path))
        except ModuleNotFoundError as exc:
            dependency_errors.append(str(exc))
        except Exception as exc:  # Keep adapter boundary non-fatal for the app route.
            runtime_errors.append(f'{extractor.__name__}: {exc}')

    if dependency_errors and not runtime_errors:
        emit(
            {
                'ok': False,
                'error': 'missing-python-dependency',
                'warnings': [
                    'PyMuPDF(fitz) 또는 pdfplumber가 설치되어 있지 않습니다.',
                    '설치 예: python3 -m pip install pymupdf 또는 python3 -m pip install pdfplumber',
                    *dependency_errors,
                ],
            }
        )

    emit(
        {
            'ok': False,
            'error': 'pdf-extraction-failed',
            'warnings': [*runtime_errors, *dependency_errors],
        }
    )


if __name__ == '__main__':
    main()
