import re

MAX_PATH_LENGTH = 512
MAX_SEGMENTS = 20
_SEGMENT_RE = re.compile(r"^[A-Za-z0-9 ._-]+$")


class InvalidPathError(ValueError):
    pass


def normalize_path(path: str) -> str:
    """Validate and normalize a user-supplied project-relative file/folder
    path. Rejects absolute paths, `..`, empty segments, and disallowed
    characters — the same discipline the compile sandbox requires (Plan.md
    §7.7), applied here too since these paths get materialized to a real
    filesystem at compile time (Phase 3)."""
    if not path:
        raise InvalidPathError("Path is required.")
    if len(path) > MAX_PATH_LENGTH:
        raise InvalidPathError("Path is too long.")
    if path.startswith("/") or path.startswith("\\"):
        raise InvalidPathError("Path must be relative.")
    segments = path.replace("\\", "/").split("/")
    if len(segments) > MAX_SEGMENTS:
        raise InvalidPathError("Path is nested too deeply.")
    clean_segments = []
    for segment in segments:
        if segment in ("", ".", ".."):
            raise InvalidPathError("Path contains an invalid segment.")
        if not _SEGMENT_RE.match(segment):
            raise InvalidPathError(
                "Path segments may only contain letters, numbers, spaces, "
                "dots, underscores and hyphens."
            )
        clean_segments.append(segment)
    return "/".join(clean_segments)


def sanitize_path(path: str) -> str:
    """Best-effort variant of normalize_path for content whose names we
    don't control (zip imports): rewrites a segment's disallowed
    *characters* to `_` instead of rejecting the whole path — mirroring the
    frontend upload sanitizer (FileTree.tsx's sanitizeFileName) so a zip
    entry like "Fig 1: Overview.png" lands renamed rather than silently
    dropped. Deliberately does NOT touch path-*structure* problems (`..`,
    absolute paths, empty segments) — those still raise, same as
    normalize_path, rather than being rewritten into a differently-located
    but "valid" path: a `../../etc/passwd` entry must stay rejected, not
    quietly reappear in the project as `etc/passwd`."""
    if path.startswith("/") or path.startswith("\\"):
        raise InvalidPathError("Path must be relative.")
    segments = path.replace("\\", "/").split("/")
    if any(s in ("", ".", "..") for s in segments):
        raise InvalidPathError("Path contains an invalid segment.")
    if len(segments) > MAX_SEGMENTS:
        raise InvalidPathError("Path is nested too deeply.")
    clean_segments = []
    for segment in segments:
        cleaned = re.sub(r"[^A-Za-z0-9 ._-]", "_", segment).strip()
        clean_segments.append(cleaned if cleaned and cleaned not in (".", "..") else "file")
    result = "/".join(clean_segments)
    if len(result) > MAX_PATH_LENGTH:
        raise InvalidPathError("Path is too long.")
    return result


_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "svg", "webp"}


def guess_file_type(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if ext == "tex":
        return "tex"
    if ext == "bib":
        return "bib"
    if ext in _IMAGE_EXTENSIONS:
        return "image"
    return "other"
