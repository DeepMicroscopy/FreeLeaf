"""Render a project dashboard thumbnail (Plan.md project-overview polish):
page 1 of the most recent successful compile, as a PNG. Uses PyMuPDF
(`fitz`) — no system package needed (unlike poppler-utils/pdftoppm), and
its AGPL-3.0 license is compatible with FreeLeaf's own.
"""

import fitz


def render_first_page_png(pdf_bytes: bytes, max_width: int = 480) -> bytes:
    """Rasterizes page 1 of `pdf_bytes` to a PNG no wider than `max_width`
    pixels (scaled down only — small pages aren't upscaled)."""
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        page = doc[0]
        zoom = min(1.0, max_width / page.rect.width)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom))
        return pix.tobytes("png")
