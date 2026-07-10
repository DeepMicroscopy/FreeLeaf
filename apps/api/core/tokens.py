import hashlib


def hash_token(token: str) -> str:
    """sha256 hex digest used to store secret tokens (magic-link, share-link)
    at rest — the raw token is only ever shown/emailed once, never persisted."""
    return hashlib.sha256(token.encode()).hexdigest()
