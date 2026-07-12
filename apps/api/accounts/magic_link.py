import secrets
from datetime import timedelta
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from core.tokens import hash_token
from core.urlsafety import safe_next_path

from .models import MagicLink, User

TOKEN_TTL_MINUTES = 15


def request_magic_link(email: str, next_path: str | None = None, callback_path: str = "/auth/magic-link") -> None:
    email = email.strip().lower()
    token = secrets.token_urlsafe(32)
    MagicLink.objects.create(
        email=email,
        token_hash=hash_token(token),
        expires_at=timezone.now() + timedelta(minutes=TOKEN_TTL_MINUTES),
    )
    params = {"token": token}
    next_path = safe_next_path(next_path)
    if next_path:
        params["next"] = next_path
    # `callback_path` defaults to the regular invite-accept callback; the
    # first-run setup wizard (Plan.md §9 Phase 11, see setup_api.py) points
    # it at a separate `/setup/verify` page instead, so its bootstrap link
    # can never be confused with — or verified through — the regular,
    # invite-gated magic-link flow.
    link = f"{settings.FRONTEND_URL}{callback_path}?{urlencode(params)}"
    send_mail(
        subject="Your FreeLeaf sign-in link",
        message=f"Sign in to FreeLeaf: {link}\n\nThis link expires in {TOKEN_TTL_MINUTES} minutes and can only be used once.",
        from_email=None,
        recipient_list=[email],
    )


class MagicLinkError(Exception):
    pass


def verify_magic_link(token: str) -> User:
    token_hash = hash_token(token)
    try:
        link = MagicLink.objects.get(token_hash=token_hash)
    except MagicLink.DoesNotExist as exc:
        raise MagicLinkError("Invalid or unknown link.") from exc

    if link.used_at is not None:
        raise MagicLinkError("This link has already been used.")
    if link.expires_at < timezone.now():
        raise MagicLinkError("This link has expired.")

    link.used_at = timezone.now()
    link.save(update_fields=["used_at"])

    user, _ = User.objects.get_or_create(kind=User.Kind.EMAIL, email=link.email)
    return user
