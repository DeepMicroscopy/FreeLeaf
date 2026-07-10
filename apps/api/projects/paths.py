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
