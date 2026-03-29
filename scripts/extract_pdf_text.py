#!/usr/bin/env python3

import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: extract_pdf_text.py <pdf-path>", file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"file not found: {pdf_path}", file=sys.stderr)
        return 2

    try:
        from pypdf import PdfReader
    except Exception as exc:  # pragma: no cover
        print(f"pypdf import failed: {exc}", file=sys.stderr)
        return 3

    reader = PdfReader(str(pdf_path))
    chunks: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            chunks.append(text.strip())

    sys.stdout.write("\n\n".join(chunks).strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
