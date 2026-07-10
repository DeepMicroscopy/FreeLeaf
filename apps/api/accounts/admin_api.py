"""In-app admin user management (Plan.md §9 Phase 7) — distinct from
Django's own /admin/ site (django.contrib.auth, staff-only, see CLAUDE.md).
Gated by accounts.User.is_admin, which nothing in the UI can grant yet;
bootstrap the first admin via `manage.py shell`."""

import uuid

from django.db.models import Count
from ninja import Router, Schema
from ninja.errors import HttpError

from core.session import get_current_user
from projects.models import Membership

from .auth import SessionAuth
from .models import User

router = Router(auth=SessionAuth())


def require_admin(user: User | None) -> None:
    if user is None:
        raise HttpError(401, "Authentication required.")
    if not user.is_admin:
        raise HttpError(403, "Admin access required.")


class AdminUserOut(Schema):
    id: uuid.UUID
    kind: str
    display_name: str | None = None
    email: str | None = None
    orcid_id: str | None = None
    is_admin: bool
    created_at: str
    last_login_at: str | None = None
    project_count: int


@router.get("/admin/users", response=list[AdminUserOut])
def list_users(request):
    user = get_current_user(request)
    require_admin(user)

    project_counts = dict(
        Membership.objects.values("user_id").annotate(count=Count("id")).values_list("user_id", "count")
    )
    users = User.objects.all().order_by("-created_at")
    return [
        AdminUserOut(
            id=u.id,
            kind=u.kind,
            display_name=u.display_name,
            email=u.email,
            orcid_id=u.orcid_id,
            is_admin=u.is_admin,
            created_at=u.created_at.isoformat(),
            last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
            project_count=project_counts.get(u.id, 0),
        )
        for u in users
    ]
