"""SyncTeX click-to-source queries (Plan.md §9 Phase 7), via the real
`synctex` CLI (texlive-binaries) rather than hand-parsing the .synctex.gz
format ourselves — that format's coordinates are relative and accumulate
through a nested box hierarchy; a naive from-scratch parser risks silently
*wrong* jumps, which is worse than no feature at all. The CLI is the
canonical, correctly-tested implementation.

Verified directly against a real compile matching this sandbox's own
invocation convention (cwd=/work/src, -output-directory=/work/out): forward
search (`synctex view`) and backward search (`synctex edit`) both print a
simple "SyncTeX result begin/end" block of "Key:value" lines to stdout —
see _parse_result. Backward search's `Input:` line echoes back
"/work/src/./<file>" for a job compiled that way, hence the prefix strip in
backward_search.
"""

import re
import subprocess
import tempfile
from pathlib import Path

SYNCTEX_TIMEOUT_SECONDS = 10


class SyncTexError(Exception):
    pass


def _parse_result(stdout: str) -> dict[str, str]:
    result: dict[str, str] = {}
    in_block = False
    for line in stdout.splitlines():
        stripped = line.strip()
        if stripped == "SyncTeX result begin":
            in_block = True
            continue
        if stripped == "SyncTeX result end":
            break
        if not in_block or ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


def forward_search(pdf_bytes: bytes, synctex_bytes: bytes, file: str, line: int) -> dict | None:
    """Source position -> PDF position ("view"). Returns None if synctex
    has no record for that file/line (e.g. a blank line, or a line synctex
    never annotated)."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pdf_path = Path(tmpdir) / "main.pdf"
        (Path(tmpdir) / "main.synctex.gz").write_bytes(synctex_bytes)
        pdf_path.write_bytes(pdf_bytes)

        proc = subprocess.run(
            ["synctex", "view", "-i", f"{line}:0:{file}", "-o", str(pdf_path)],
            capture_output=True, text=True, timeout=SYNCTEX_TIMEOUT_SECONDS,
        )
        result = _parse_result(proc.stdout)
        if "Page" not in result:
            return None
        return {
            "page": int(result["Page"]),
            "x": float(result["x"]),
            "y": float(result["y"]),
            "h": float(result["h"]),
            "v": float(result["v"]),
            "width": float(result["W"]),
            "height": float(result["H"]),
        }


def backward_search(pdf_bytes: bytes, synctex_bytes: bytes, page: int, x: float, y: float) -> dict | None:
    """PDF position -> source position ("edit"). Returns None if synctex
    has no record near that point."""
    with tempfile.TemporaryDirectory() as tmpdir:
        pdf_path = Path(tmpdir) / "main.pdf"
        (Path(tmpdir) / "main.synctex.gz").write_bytes(synctex_bytes)
        pdf_path.write_bytes(pdf_bytes)

        proc = subprocess.run(
            ["synctex", "edit", "-o", f"{page}:{x}:{y}:{pdf_path}"],
            capture_output=True, text=True, timeout=SYNCTEX_TIMEOUT_SECONDS,
        )
        result = _parse_result(proc.stdout)
        if "Line" not in result:
            return None
        input_path = result.get("Input", "")
        file = re.sub(r"^/work/src/\.?/?", "", input_path)
        return {
            "file": file,
            "line": int(result["Line"]),
            "column": int(result["Column"]),
        }
