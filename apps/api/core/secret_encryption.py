"""Symmetric encryption for SSO provider secrets at rest (LDAP bind
password) — Plan.md §9 Phase 9. Defense in depth, not a substitute for
proper secrets management in a real deployment: the derived key lives in
the same database-adjacent process as the ciphertext, so anyone with
Django's SECRET_KEY *and* DB access could decrypt it. What this actually
buys: a DB dump/backup alone (without the separately-configured
SECRET_KEY) doesn't expose bind passwords in plaintext.
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken:
        # SECRET_KEY rotated since encryption, or corrupted data — treat as
        # "no usable secret" rather than crashing the whole auth attempt.
        return ""
