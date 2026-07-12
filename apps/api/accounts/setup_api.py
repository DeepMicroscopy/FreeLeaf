"""First-run setup (Plan.md §9 Phase 11): a fresh install has no admin user
and no way to grant `is_admin` from the UI, previously requiring a
`manage.py shell` step. Gated purely by DB state — "does any admin user
exist yet" — not a separate one-time-flag/session concept: whichever
identity completes sign-in *first* while that's false becomes the admin.

This only adds a *new*, ungated bootstrap path for magic-link sign-in
(`request-admin-link`/`verify-admin-link` below) — the normal
`/auth/magic-link/*` endpoints stay invite-link-gated exactly as before, so
nothing about their security posture changes. ORCID needs no separate
bootstrap path: signing in with ORCID was already a generally-available,
ungated action from the login page, so `orcid_callback` (accounts/api.py)
just promotes the user directly if no admin exists yet — see the comment
there for why that's safe.
"""

from ninja import Router, Schema
from ninja.errors import HttpError

from core.ratelimit import check_rate_limit, client_ip
from core.session import log_in

from . import orcid
from .api import UserOut, _user_out
from .magic_link import MagicLinkError, request_magic_link, verify_magic_link
from .models import SiteSettings, User

router = Router()


def needs_setup() -> bool:
    return not User.objects.filter(is_admin=True).exists()


class SetupStatusOut(Schema):
    needs_setup: bool
    # `orcid_available` = enabled *and* has real credentials — what the
    # login page should key off. `orcid_configured` is offered separately
    # so the wizard can still show a (disabled) toggle explaining *why*
    # ORCID isn't an option, rather than just hiding it silently.
    orcid_available: bool
    orcid_configured: bool
    orcid_enabled: bool


def _setup_status_out() -> SetupStatusOut:
    s = SiteSettings.load()
    configured = bool(orcid.CLIENT_ID and orcid.CLIENT_SECRET)
    return SetupStatusOut(
        needs_setup=needs_setup(),
        orcid_available=s.orcid_enabled and configured,
        orcid_configured=configured,
        orcid_enabled=s.orcid_enabled,
    )


@router.get("/setup/status", response=SetupStatusOut)
def setup_status(request):
    return _setup_status_out()


class SetupOrcidIn(Schema):
    orcid_enabled: bool


@router.put("/setup/orcid-enabled", response=SetupStatusOut)
def setup_set_orcid_enabled(request, payload: SetupOrcidIn):
    # Only reachable while no admin exists yet — once setup completes,
    # this toggle moves to the normal admin-gated /admin/site-settings.
    if not needs_setup():
        raise HttpError(400, "Setup has already been completed on this instance.")
    s = SiteSettings.load()
    s.orcid_enabled = payload.orcid_enabled
    s.save(update_fields=["orcid_enabled"])
    return _setup_status_out()


class RequestAdminLinkIn(Schema):
    email: str


@router.post("/setup/request-admin-link")
def request_admin_link(request, payload: RequestAdminLinkIn):
    if not needs_setup():
        raise HttpError(400, "Setup has already been completed on this instance.")
    check_rate_limit(f"setup-link:{payload.email.lower()}", limit=3, window_seconds=15 * 60)
    check_rate_limit(f"setup-link-ip:{client_ip(request)}", limit=10, window_seconds=15 * 60)
    request_magic_link(payload.email, callback_path="/setup/verify")
    return {"detail": "If that address is valid, a sign-in link has been sent."}


class VerifyAdminLinkIn(Schema):
    token: str


@router.post("/setup/verify-admin-link", response=UserOut)
def verify_admin_link(request, payload: VerifyAdminLinkIn):
    # Re-checked here, not just at request time above: someone else could
    # have completed setup in the meantime (e.g. two browser tabs racing).
    if not needs_setup():
        raise HttpError(400, "Setup has already been completed on this instance.")
    try:
        user = verify_magic_link(payload.token)
    except MagicLinkError as exc:
        raise HttpError(400, str(exc)) from exc

    user.is_admin = True
    user.save(update_fields=["is_admin"])
    log_in(request, user)
    return _user_out(user)
