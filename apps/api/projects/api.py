import hashlib
import secrets
import uuid
from datetime import timedelta

from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import CsrfProtect, SessionAuth
from accounts.models import User
from core.ratelimit import check_rate_limit, client_ip
from core.session import get_current_user, log_in

from .authz import get_authorized_project, require_role
from .files_api import create_main_tex
from .models import Membership, Project, Role, ShareLink

router = Router(auth=SessionAuth())


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ProjectOut(Schema):
    id: uuid.UUID
    name: str
    role: str
    created_at: str
    updated_at: str


def _project_out(project: Project, role: str) -> ProjectOut:
    return ProjectOut(
        id=project.id,
        name=project.name,
        role=role,
        created_at=project.created_at.isoformat(),
        updated_at=project.updated_at.isoformat(),
    )


@router.get("/projects", response=list[ProjectOut])
def list_projects(request):
    user = get_current_user(request)
    memberships = Membership.objects.filter(user=user).select_related("project")
    return [_project_out(m.project, m.role) for m in memberships]


class ProjectCreateIn(Schema):
    name: str


@router.post("/projects", response=ProjectOut)
def create_project(request, payload: ProjectCreateIn):
    user = get_current_user(request)
    if user is None:
        raise HttpError(401, "Authentication required.")
    if user.kind == User.Kind.ANONYMOUS:
        raise HttpError(403, "Anonymous users can't create projects — sign in with ORCID or email.")
    name = payload.name.strip()
    if not name:
        raise HttpError(400, "Project name is required.")

    project = Project.objects.create(owner=user, name=name)
    membership = Membership.objects.create(project=project, user=user, role=Role.OWNER)
    create_main_tex(project)
    return _project_out(project, membership.role)


@router.get("/projects/{project_id}", response=ProjectOut)
def get_project(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    return _project_out(project, membership.role)


class ProjectUpdateIn(Schema):
    name: str


@router.patch("/projects/{project_id}", response=ProjectOut)
def update_project(request, project_id: uuid.UUID, payload: ProjectUpdateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    name = payload.name.strip()
    if not name:
        raise HttpError(400, "Project name is required.")
    project.name = name
    project.save(update_fields=["name", "updated_at"])
    return _project_out(project, membership.role)


@router.delete("/projects/{project_id}")
def delete_project(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)
    project.delete()
    return {"detail": "deleted"}


# --- Share links -----------------------------------------------------------


class ShareLinkCreateIn(Schema):
    role: str = Role.EDITOR
    expires_in_hours: int | None = None


class ShareLinkOut(Schema):
    id: uuid.UUID
    role: str
    expires_at: str | None = None
    created_at: str
    token: str | None = None  # only populated once, at creation


def _share_link_out(link: ShareLink, token: str | None = None) -> ShareLinkOut:
    return ShareLinkOut(
        id=link.id,
        role=link.role,
        expires_at=link.expires_at.isoformat() if link.expires_at else None,
        created_at=link.created_at.isoformat(),
        token=token,
    )


@router.post("/projects/{project_id}/share-links", response=ShareLinkOut)
def create_share_link(request, project_id: uuid.UUID, payload: ShareLinkCreateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)
    if payload.role not in (Role.EDITOR, Role.VIEWER):
        raise HttpError(400, "role must be 'editor' or 'viewer'.")

    token = secrets.token_urlsafe(32)
    expires_at = None
    if payload.expires_in_hours is not None:
        expires_at = timezone.now() + timedelta(hours=payload.expires_in_hours)

    link = ShareLink.objects.create(
        project=project,
        token_hash=_hash_token(token),
        role=payload.role,
        expires_at=expires_at,
    )
    return _share_link_out(link, token=token)


@router.get("/projects/{project_id}/share-links", response=list[ShareLinkOut])
def list_share_links(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)
    return [_share_link_out(link) for link in project.share_links.all()]


@router.delete("/projects/{project_id}/share-links/{link_id}")
def revoke_share_link(request, project_id: uuid.UUID, link_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)
    deleted, _ = project.share_links.filter(id=link_id).delete()
    if not deleted:
        raise HttpError(404, "Share link not found.")
    return {"detail": "revoked"}


class ShareLinkJoinIn(Schema):
    display_name: str | None = None


@router.post("/share-links/{token}/join", response=ProjectOut, auth=CsrfProtect())
def join_via_share_link(request, token: str, payload: ShareLinkJoinIn):
    check_rate_limit(f"share-join:{client_ip(request)}", limit=20, window_seconds=60)

    link = ShareLink.objects.filter(token_hash=_hash_token(token)).select_related("project").first()
    if link is None:
        raise HttpError(404, "Invalid or expired invite link.")
    if link.expires_at and link.expires_at < timezone.now():
        raise HttpError(404, "Invalid or expired invite link.")

    user = get_current_user(request)
    if user is None:
        display_name = (payload.display_name or "").strip() or None
        user = User.objects.create(kind=User.Kind.ANONYMOUS, display_name=display_name)
        log_in(request, user)

    membership, _ = Membership.objects.get_or_create(
        project=link.project, user=user, defaults={"role": link.role}
    )
    return _project_out(link.project, membership.role)
