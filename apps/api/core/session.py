from django.utils import timezone

SESSION_USER_KEY = "fl_user_id"


def get_current_user(request):
    """Return the accounts.User for this session, or None."""
    return getattr(request, "fl_user", None)


def log_in(request, user) -> None:
    request.session[SESSION_USER_KEY] = str(user.id)
    request.session.cycle_key()
    request.fl_user = user
    user.last_login_at = timezone.now()
    user.save(update_fields=["last_login_at"])


def log_out(request) -> None:
    request.session.pop(SESSION_USER_KEY, None)
    request.session.cycle_key()
    request.fl_user = None
