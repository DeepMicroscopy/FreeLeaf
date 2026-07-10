# ADR: ORCID OAuth2 scope — `openid` instead of `/authenticate`

**Status:** accepted (Phase 1)

## Decision

Request scope `openid` for "Sign in with ORCID", not `/authenticate` as literally named in Plan.md §9.

## Rationale

Per CLAUDE.md's instruction to verify ORCID endpoints against live docs before building: ORCID's current API tutorial ("Get an Authenticated ORCID iD", info.orcid.org) states "If you are using the /authenticate scope replace it with openid, as authenticate and openid have the same authorization — only one or the other should be used." `/authenticate` is the older, now-superseded name for the identical sign-in-only authorization; `openid` is what ORCID's live docs currently document.

Endpoints (verified 2026-07-10): authorize/token at `https://{sandbox.}orcid.org/oauth/{authorize,token}`; the token response returns `orcid` and `name` directly. Full detail in `apps/api/accounts/orcid.py`'s module docstring.

## Consequences

None functionally — same authorization grant, same user-facing flow. Anyone reading Plan.md §9 literally would expect `/authenticate` in the code; this note explains why `openid` appears instead.
