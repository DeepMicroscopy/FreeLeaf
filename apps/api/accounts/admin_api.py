"""In-app admin user management (Plan.md §9 Phase 7) — distinct from
Django's own /admin/ site (django.contrib.auth, staff-only, see CLAUDE.md).
Gated by accounts.User.is_admin — bootstrapped for a fresh install by the
first-run setup wizard (Plan.md §9 Phase 11, see setup_api.py), not a
`manage.py shell` step anymore."""

import uuid

from django.db.models import Count
from ninja import Router, Schema
from ninja.errors import HttpError

from core.session import get_current_user
from projects.models import Membership

from . import orcid
from .auth import SessionAuth
from .models import SiteSettings, SsoProvider, User

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


def _admin_user_out(u: User, project_count: int) -> AdminUserOut:
    return AdminUserOut(
        id=u.id,
        kind=u.kind,
        display_name=u.display_name,
        email=u.email,
        orcid_id=u.orcid_id,
        is_admin=u.is_admin,
        created_at=u.created_at.isoformat(),
        last_login_at=u.last_login_at.isoformat() if u.last_login_at else None,
        project_count=project_count,
    )


def _project_counts() -> dict:
    return dict(Membership.objects.values("user_id").annotate(count=Count("id")).values_list("user_id", "count"))


@router.get("/admin/users", response=list[AdminUserOut])
def list_users(request):
    user = get_current_user(request)
    require_admin(user)

    project_counts = _project_counts()
    users = User.objects.all().order_by("-created_at")
    return [_admin_user_out(u, project_counts.get(u.id, 0)) for u in users]


def _get_user_or_404(user_id: uuid.UUID) -> User:
    target = User.objects.filter(id=user_id).first()
    if target is None:
        raise HttpError(404, "User not found.")
    return target


class UpdateUserAdminIn(Schema):
    is_admin: bool


@router.patch("/admin/users/{user_id}", response=AdminUserOut)
def update_user_admin(request, user_id: uuid.UUID, payload: UpdateUserAdminIn):
    require_admin(get_current_user(request))
    target = _get_user_or_404(user_id)

    if target.is_admin and not payload.is_admin and not User.objects.filter(is_admin=True).exclude(id=target.id).exists():
        raise HttpError(400, "Can't remove admin from the last remaining admin.")

    target.is_admin = payload.is_admin
    target.save(update_fields=["is_admin"])
    return _admin_user_out(target, _project_counts().get(target.id, 0))


@router.delete("/admin/users/{user_id}")
def delete_user(request, user_id: uuid.UUID):
    require_admin(get_current_user(request))
    target = _get_user_or_404(user_id)

    if target.is_admin and not User.objects.filter(is_admin=True).exclude(id=target.id).exists():
        raise HttpError(400, "Can't delete the last remaining admin.")

    # Memberships cascade-delete (they're meaningless without the user);
    # owned projects and anything else pointing at this user (comments,
    # snapshots, ...) fall back to SET_NULL — deleting an account never
    # deletes a project or its content out from under other collaborators.
    target.delete()
    return {"detail": "User deleted."}


class SiteSettingsOut(Schema):
    orcid_enabled: bool
    # Whether ORCID has real credentials configured at all (env vars) —
    # informational: toggling `orcid_enabled` on with no credentials set
    # would just produce a broken "Sign in with ORCID" button.
    orcid_configured: bool
    site_name: str
    template_contribution_mode: str


class SiteSettingsIn(Schema):
    orcid_enabled: bool
    site_name: str
    template_contribution_mode: str | None = None


def _site_settings_out(s: SiteSettings) -> SiteSettingsOut:
    return SiteSettingsOut(
        orcid_enabled=s.orcid_enabled,
        orcid_configured=bool(orcid.CLIENT_ID and orcid.CLIENT_SECRET),
        site_name=s.site_name,
        template_contribution_mode=s.template_contribution_mode,
    )


@router.get("/admin/site-settings", response=SiteSettingsOut)
def get_site_settings(request):
    require_admin(get_current_user(request))
    return _site_settings_out(SiteSettings.load())


@router.put("/admin/site-settings", response=SiteSettingsOut)
def update_site_settings(request, payload: SiteSettingsIn):
    require_admin(get_current_user(request))
    s = SiteSettings.load()
    # ORCID and institutional SSO are the only sign-in methods generally
    # reachable from the login page (magic-link/anonymous both require an
    # existing project's invite link) — block turning off the last one so
    # an admin can't accidentally lock everyone, including themselves, out.
    if not payload.orcid_enabled and not SsoProvider.objects.filter(enabled=True).exists():
        raise HttpError(400, "Can't disable ORCID while no institutional SSO provider is enabled — nobody would be able to sign in.")
    site_name = payload.site_name.strip()
    if not site_name:
        raise HttpError(400, "Site name can't be blank.")
    s.orcid_enabled = payload.orcid_enabled
    s.site_name = site_name
    update_fields = ["orcid_enabled", "site_name"]
    if payload.template_contribution_mode is not None:
        valid_modes = {c.value for c in SiteSettings.TemplateContributionMode}
        if payload.template_contribution_mode not in valid_modes:
            raise HttpError(400, "Invalid template contribution mode.")
        s.template_contribution_mode = payload.template_contribution_mode
        update_fields.append("template_contribution_mode")
    s.save(update_fields=update_fields)
    return _site_settings_out(s)
