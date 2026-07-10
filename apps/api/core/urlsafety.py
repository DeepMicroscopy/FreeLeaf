def safe_next_path(next_path: str | None) -> str | None:
    """Only allow same-origin relative paths as post-login redirect targets.

    Rejects protocol-relative ("//evil.com/..."), absolute ("https://..."),
    and scheme URLs ("javascript:...") to prevent open-redirect abuse of the
    ORCID/magic-link "return to where you started" flow.
    """
    if not next_path:
        return None
    if not next_path.startswith("/"):
        return None
    if next_path.startswith("//"):
        return None
    if "://" in next_path:
        return None
    return next_path
