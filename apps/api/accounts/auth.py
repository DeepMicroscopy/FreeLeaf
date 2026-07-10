from ninja.security import APIKeyCookie

from core.session import SESSION_USER_KEY

from .models import User


class SessionAuth(APIKeyCookie):
    """Authenticates via the Django session cookie. CSRF-protected: unsafe
    methods must send X-CSRFToken matching the csrftoken cookie (obtained
    from GET /auth/csrf) — enforced by APIKeyCookie's built-in check."""

    param_name = "sessionid"

    def authenticate(self, request, key):
        user_id = request.session.get(SESSION_USER_KEY)
        if not user_id:
            return None
        return User.objects.filter(id=user_id).first()


class CsrfProtect(APIKeyCookie):
    """CSRF-protects a POST endpoint that must also work with *no* prior
    session (first-time anonymous/magic-link/share-link sign-in). Unlike
    SessionAuth, never fails auth by itself — the view reads the optional
    current user via core.session.get_current_user()."""

    param_name = "sessionid"

    def authenticate(self, request, key):
        return True
