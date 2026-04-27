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
    import re
    import pdfplumber  # type: ignore[import-not-found]

    pages: list[dict[str, Any]] = []
    comparison_rows: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    current_title = ''
    current_reason = ''

    def flush_current() -> None:
        nonlocal current
        if not current:
            return
        old_text = clean_cell_text('\n'.join(current['old_parts']))
        new_text = clean_cell_text('\n'.join(current['new_parts']))
        note = clean_cell_text('\n'.join(current['note_parts']))
        if old_text or new_text:
            comparison_rows.append({
                'article': infer_article(old_text, new_text) or current.get('title') or 'PDF 신구조문 대비표',
                'oldText': old_text,
                'newText': new_text,
                'reason': note or current.get('reason') or current.get('title'),
                'page': current.get('page'),
                'confidence': 0.74 if note else 0.68,
                'warnings': ['pdfplumber 좌표 기반으로 현행/개정(안)/비고 컬럼을 복원했습니다. 병합표·다단표는 원문 확인이 필요합니다.'],
            })
        current = None

    with pdfplumber.open(str(pdf_path)) as document:
        for index, page in enumerate(document.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ''
            pages.append({'page': index, 'text': text})

            title_match = re.search(r'\d+\.\s+([^\n]+?(?:규정|정관|세칙)\s+개정\(안\))', text)
            if title_match:
                flush_current()
                current_title = clean_cell_text(title_match.group(1))
                current_reason = clean_cell_text((re.search(r'가\.\s*개정사유\s*([\s\S]*?)\n\s*나\.\s*주요\s*개정내용', text) or ['',''])[1])

            words = page.extract_words(use_text_flow=False, keep_blank_chars=False) or []
            header_words = [word for word in words if word.get('text') in {'현', '행', '개', '정(안)', '비고'}]
            if len(header_words) < 3 or '신․구' not in text and '신·구' not in text and '현 행' not in text:
                if current and title_match:
                    flush_current()
                continue

            header_top = min((float(word['top']) for word in header_words), default=0)
            old_parts: list[str] = []
            new_parts: list[str] = []
            note_parts: list[str] = []
            for word in words:
                top = float(word['top'])
                x0 = float(word['x0'])
                token = str(word.get('text') or '').strip()
                if not token or top <= header_top + 8:
                    continue
                if re.fullmatch(r'-|\d+|-?\s*\d+\s*-', token):
                    continue
                if x0 < 270:
                    old_parts.append(token)
                elif x0 < 480:
                    new_parts.append(token)
                else:
                    note_parts.append(token)

            if not old_parts and not new_parts:
                continue
            if current is None:
                current = {'title': current_title, 'reason': current_reason, 'page': index, 'old_parts': [], 'new_parts': [], 'note_parts': []}
            current['old_parts'].append(' '.join(old_parts))
            current['new_parts'].append(' '.join(new_parts))
            current['note_parts'].append(' '.join(note_parts))

    flush_current()
    return {'ok': True, 'engine': 'pdfplumber', 'pages': pages, 'comparisonRows': comparison_rows, 'warnings': ['PDF 텍스트와 표 컬럼을 pdfplumber adapter로 추출했습니다.']}


def clean_cell_text(value: str) -> str:
    import re
    return re.sub(r'\s+', ' ', value or '').strip()


def infer_article(*values: str) -> str | None:
    import re
    for value in values:
        match = re.search(r'제\s*\d+\s*조(?:의\s*\d+)?\s*\([^)]{1,40}\)', value or '')
        if match:
            return clean_cell_text(match.group(0))
        appendix = re.search(r'<\s*별표\s*[^>]{1,80}>', value or '')
        if appendix:
            return clean_cell_text(appendix.group(0))
    return None


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
