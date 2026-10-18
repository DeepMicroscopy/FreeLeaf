import xml.etree.ElementTree as ET

import fitz

_PDF_MAGIC = b"%PDF-"
_IMAGE_MAGIC = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "gif": (b"GIF87a", b"GIF89a"),
}


class InvalidFileContentError(ValueError):
    pass


def validate_file_content(path: str, data: bytes) -> None:
    """Rejects a file whose bytes don't actually match what its extension
    claims, so a corrupt or misnamed upload fails here instead of silently
    breaking later at compile time (a bad \\includegraphics source) or in
    thumbnails.py's PDF-to-PNG render.

    Checked PyMuPDF's own `filetype=` hint against live data first rather
    than trusting its docs: it happily decodes garbage as a 1-page "png"
    and opens a real PNG as a 1-page "pdf", so it can't be trusted alone.
    Magic bytes narrow the claimed format first; PyMuPDF then confirms the
    bytes actually decode (catching truncation/corruption past the header).
    WebP isn't decodable by this PyMuPDF build at all, so it gets a
    magic-bytes-only check.
    """
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""

    if ext == "pdf":
        if not data.startswith(_PDF_MAGIC):
            raise InvalidFileContentError("This file isn't a valid PDF.")
        try:
            with fitz.open(stream=data, filetype="pdf") as doc:
                if doc.page_count < 1:
                    raise InvalidFileContentError("This file isn't a valid PDF.")
        except InvalidFileContentError:
            raise
        except Exception as exc:
            raise InvalidFileContentError("This file isn't a valid PDF.") from exc
        return

    if ext == "svg":
        try:
            root = ET.fromstring(data)
        except ET.ParseError as exc:
            raise InvalidFileContentError("This file isn't a valid SVG.") from exc
        if not root.tag.endswith("svg"):
            raise InvalidFileContentError("This file isn't a valid SVG.")
        return

    if ext == "webp":
        if not (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
            raise InvalidFileContentError("This file isn't a valid WebP image.")
        return

    magics = _IMAGE_MAGIC.get(ext)
    if magics is not None:
        if not data.startswith(magics):
            raise InvalidFileContentError(f"This file isn't a valid {ext.upper()} image.")
        try:
            fitz.Pixmap(data)
        except Exception as exc:
            raise InvalidFileContentError(f"This file isn't a valid {ext.upper()} image.") from exc
        return
