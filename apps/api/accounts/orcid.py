"""ORCID OAuth2 "Sign in with ORCID" client.

Verified against ORCID's live API tutorial (info.orcid.org, "Get an
Authenticated ORCID iD") on 2026-07-10:

- Authorize: https://{sandbox.}orcid.org/oauth/authorize
- Token:     https://{sandbox.}orcid.org/oauth/token  (POST, form-encoded)
- Scope: `openid` (ORCID's current docs say to use this in place of the
  older `/authenticate` scope named in Plan.md §9 — "authenticate and
  openid have the same authorization, only one or the other should be
  used" per ORCID's own guidance).
- The token response includes `orcid` and `name` directly, no follow-up
  API call needed:
    {"access_token", "token_type", "expires_in", "scope",
     "name", "orcid", "id_token"}

We trust `orcid`/`name` from this response as-is: it's a direct
server-to-server HTTPS response to a request authenticated with our
client secret, which is the standard trust boundary for this flow. Full
`id_token` (JWT) signature verification is not implemented — a possible
future hardening step, not required for this trust model.
"""

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlencode

ORCID_ENV = os.environ.get("ORCID_ENV", "sandbox")
_ORCID_BASE = "https://sandbox.orcid.org" if ORCID_ENV == "sandbox" else "https://orcid.org"
AUTHORIZE_URL = f"{_ORCID_BASE}/oauth/authorize"
TOKEN_URL = f"{_ORCID_BASE}/oauth/token"

CLIENT_ID = os.environ.get("ORCID_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("ORCID_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("ORCID_REDIRECT_URI", "http://localhost:8000/api/auth/orcid/callback")


class OrcidError(Exception):
    pass


@dataclass
class OrcidIdentity:
    orcid_id: str
    name: str | None


def build_authorize_url(state: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "scope": "openid",
        "redirect_uri": REDIRECT_URI,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


def exchange_code(code: str) -> OrcidIdentity:
    body = urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": REDIRECT_URI,
        }
    ).encode()
    request = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise OrcidError(f"ORCID token exchange failed: {exc.code} {exc.read().decode()}") from exc
    except urllib.error.URLError as exc:
        raise OrcidError(f"ORCID token exchange failed: {exc.reason}") from exc

    orcid_id = data.get("orcid")
    if not orcid_id:
        raise OrcidError("ORCID token response did not include an orcid iD")
    return OrcidIdentity(orcid_id=orcid_id, name=data.get("name"))
