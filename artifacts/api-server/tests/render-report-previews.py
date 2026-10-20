"""Render the STUB-only verification PDFs for visual inspection, never app data."""
from pathlib import Path
import pymupdf

output = Path(__file__).resolve().parents[3] / "generated-artifacts" / "stage3-verification"
for stem in ("STUB_Forster_statement", "STUB_board_summary"):
    with pymupdf.open(output / f"{stem}.pdf") as document:
        assert len(document) == 1, f"{stem} must have exactly one page"
        document[0].get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(output / f"{stem}.png")
        print(f"Rendered DEVELOPMENT / STUB preview: {stem}.png")
