from core.session import SESSION_USER_KEY

from .models import User


class CurrentUserMiddleware:
    """Resolves the FreeLeaf application user (accounts.User) for the
    current session and attaches it as `request.fl_user`.

    Deliberately independent of django.contrib.auth: FreeLeaf has no
    passwords (ORCID / magic-link / anonymous only), so contrib.auth's
    User model is reserved for Django admin staff accounts only.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.fl_user = None
        user_id = request.session.get(SESSION_USER_KEY)
        if user_id:
            request.fl_user = User.objects.filter(id=user_id).first()
        return self.get_response(request)
