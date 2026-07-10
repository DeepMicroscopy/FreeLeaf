"""Short-lived signed tokens handed to the frontend so it can open a
WebSocket directly to the Node `collab` service (PLAN.md §6) without that
service needing its own session/DB access — it verifies the HMAC locally.

Format: "<base64url(json payload)>.<hex hmac-sha256 signature>". Deliberately
not JWT: one shared secret, one fixed payload shape, no algorithm-confusion
surface, and the format is trivial to reproduce with Node's built-in `crypto`
on the collab side (see apps/collab/src/token.ts) without pulling in a JWT
library on either end.
"""

import base64
import hashlib
import hmac
import json
import time


class InvalidCollabToken(Exception):
    pass


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign_collab_token(payload: dict, secret: str) -> str:
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"


def verify_collab_token(token: str, secret: str) -> dict:
    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError as exc:
        raise InvalidCollabToken("malformed token") from exc

    expected = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise InvalidCollabToken("bad signature")

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except (ValueError, UnicodeDecodeError) as exc:
        raise InvalidCollabToken("malformed payload") from exc

    if payload.get("exp", 0) < time.time():
        raise InvalidCollabToken("expired")
    return payload
