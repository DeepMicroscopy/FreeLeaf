import secrets
import uuid

from django.conf import settings
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from ninja import Router, Schema
from ninja.errors import HttpError

from core.ratelimit import check_rate_limit, client_ip
from core.session import get_current_user, log_in, log_out
from core.urlsafety import safe_next_path

from . import orcid
from .auth import CsrfProtect, SessionAuth
from .magic_link import MagicLinkError, request_magic_link, verify_magic_link
from .models import User

router = Router()
session_auth = SessionAuth()
csrf_protect = CsrfProtect()


class UserOut(Schema):
    id: uuid.UUID
    kind: str
    display_name: str | None = None
    email: str | None = None
    orcid_id: str | None = None


def _user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        kind=user.kind,
        display_name=user.display_name,
        email=user.email,
        orcid_id=user.orcid_id,
    )


@router.get("/auth/csrf")
def get_csrf(request):
    # Forces Django's CsrfViewMiddleware to set the csrftoken cookie on the
    # response. (@ensure_csrf_cookie doesn't compose with ninja's dict-return
    # views — it expects the wrapped view to already return an HttpResponse.)
    get_token(request)
    return {"detail": "csrf cookie set"}


@router.get("/auth/me", response=UserOut | None)
def me(request):
    user = get_current_user(request)
    return _user_out(user) if user else None


@router.post("/auth/logout", auth=csrf_protect)
def logout(request):
    log_out(request)
    return {"detail": "logged out"}


class AnonymousLoginIn(Schema):
    display_name: str | None = None


@router.post("/auth/anonymous", response=UserOut, auth=csrf_protect)
def anonymous_login(request, payload: AnonymousLoginIn):
    check_rate_limit(f"anon:{client_ip(request)}", limit=10, window_seconds=60)
    display_name = (payload.display_name or "").strip() or None
    user = User.objects.create(kind=User.Kind.ANONYMOUS, display_name=display_name)
    log_in(request, user)
    return _user_out(user)


class MagicLinkRequestIn(Schema):
    email: str
    next: str | None = None


@router.post("/auth/magic-link/request", auth=csrf_protect)
def magic_link_request(request, payload: MagicLinkRequestIn):
    check_rate_limit(f"magic-link:{payload.email.lower()}", limit=3, window_seconds=15 * 60)
    check_rate_limit(f"magic-link-ip:{client_ip(request)}", limit=10, window_seconds=15 * 60)
    request_magic_link(payload.email, next_path=payload.next)
    # Always the same response, whether or not the address is known, to avoid
    # leaking account existence.
    return {"detail": "If that address is valid, a sign-in link has been sent."}


class MagicLinkVerifyIn(Schema):
    token: str


@router.post("/auth/magic-link/verify", response=UserOut, auth=csrf_protect)
def magic_link_verify(request, payload: MagicLinkVerifyIn):
    try:
        user = verify_magic_link(payload.token)
    except MagicLinkError as exc:
        raise HttpError(400, str(exc)) from exc
    log_in(request, user)
    return _user_out(user)


@router.get("/auth/orcid/login")
def orcid_login(request, next: str | None = None):
    state = secrets.token_urlsafe(24)
    request.session["orcid_oauth_state"] = state
    safe_next = safe_next_path(next)
    if safe_next:
        request.session["orcid_next"] = safe_next
    return HttpResponseRedirect(orcid.build_authorize_url(state))


@router.get("/auth/orcid/callback")
def orcid_callback(request, code: str | None = None, state: str | None = None, error: str | None = None):
    # Separate, specific error messages on purpose: a generic "failed or was
    # cancelled" for every case makes this unfixable from the outside. Each
    # branch here points at a different root cause.
    expected_state = request.session.pop("orcid_oauth_state", None)

    if error:
        raise HttpError(400, f"ORCID returned an error: {error}")
    if not code or not state:
        raise HttpError(400, "ORCID did not return the expected code/state parameters.")
    if not expected_state:
        raise HttpError(
            400,
            "No sign-in session found for this callback. The session cookie set when "
            "sign-in started didn't come back with this request — check that cookies "
            "aren't blocked for this domain, that DJANGO_ALLOWED_HOSTS/CORS_ALLOWED_ORIGINS/"
            "CSRF_TRUSTED_ORIGINS include this exact host, and that nothing (a CDN, a "
            "caching reverse proxy) is caching the redirect response from /auth/orcid/login "
            "— that response's Set-Cookie header must reach every real visitor, not just the first.",
        )
    if not secrets.compare_digest(state, expected_state):
        raise HttpError(400, "ORCID sign-in state did not match — possible session mismatch or replay.")

    try:
        identity = orcid.exchange_code(code)
    except orcid.OrcidError as exc:
        raise HttpError(400, str(exc)) from exc

    user, created = User.objects.get_or_create(
        kind=User.Kind.ORCID,
        orcid_id=identity.orcid_id,
        defaults={"display_name": identity.name},
    )
    if not created and identity.name and user.display_name != identity.name:
        user.display_name = identity.name
        user.save(update_fields=["display_name"])

    log_in(request, user)
    next_path = request.session.pop("orcid_next", None)
    return HttpResponseRedirect(f"{settings.FRONTEND_URL}{next_path or ''}")
