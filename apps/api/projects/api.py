import io
import mimetypes
import re
import secrets
import uuid
import zipfile
from datetime import timedelta

from django.db import IntegrityError
from django.http import HttpResponse
from django.utils import timezone
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.auth import CsrfProtect, SessionAuth
from accounts.models import User
from core import storage
from core.ratelimit import check_rate_limit, client_ip
from core.session import get_current_user, log_in
from core.tokens import hash_token

from .authz import get_authorized_project, require_role
from .files_api import create_main_tex, storage_key_for
from .models import FileType, Membership, Project, ProjectFile, Role, ShareLink
from .paths import InvalidPathError, guess_file_type, normalize_path

router = Router(auth=SessionAuth())

MAX_ZIP_BYTES = 100 * 1024 * 1024  # 20 MB compressed upload
MAX_ZIP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024  # 50 MB total once extracted
MAX_ZIP_ENTRIES = 500
_IGNORED_BASENAMES = {".ds_store", "thumbs.db"}


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


def _common_leading_dir(names: list[str]) -> str:
    """If every entry shares one top-level directory, return that prefix
    (with a trailing slash) so it can be stripped. Common in zip exports
    that wrap the whole project in one folder (e.g. Overleaf's "Download
    as zip") — without this, every file would land one level deeper than
    the user expects."""
    if not names:
        return ""
    tops = {n.split("/", 1)[0] for n in names if "/" in n}
    if len(tops) == 1:
        prefix = next(iter(tops)) + "/"
        if all(n.startswith(prefix) for n in names):
            return prefix
    return ""


@router.post("/projects/import", response=ProjectOut)
def import_project_zip(request, name: str, file: UploadedFile = File(...)):
    """Create a new project from an uploaded .zip (Plan.md §9 Phase 7).
    Unsafe or junk entries (path traversal, absolute paths, OS metadata
    like __MACOSX/.DS_Store, dotfiles) are silently skipped rather than
    failing the whole import — the same "validate every entry independently,
    never trust the archive" discipline as the compile sandbox's tar
    extraction (apps/compile/sandbox.py's _safe_extract), applied here to
    Python's zipfile instead of tarfile."""
    user = get_current_user(request)
    if user is None:
        raise HttpError(401, "Authentication required.")
    if user.kind == User.Kind.ANONYMOUS:
        raise HttpError(403, "Anonymous users can't create projects — sign in with ORCID or email.")

    clean_name = name.strip()
    if not clean_name:
        raise HttpError(400, "Project name is required.")

    zip_bytes = file.read()
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise HttpError(413, "Zip file is too large.")

    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except zipfile.BadZipFile as exc:
        raise HttpError(400, "That doesn't look like a valid .zip file.") from exc

    infos = [i for i in zf.infolist() if not i.is_dir()]
    if not infos:
        raise HttpError(400, "The zip file is empty.")
    if len(infos) > MAX_ZIP_ENTRIES:
        raise HttpError(400, f"Too many files in the zip (max {MAX_ZIP_ENTRIES}).")
    if sum(i.file_size for i in infos) > MAX_ZIP_UNCOMPRESSED_BYTES:
        raise HttpError(413, "Zip contents are too large once extracted.")

    common_prefix = _common_leading_dir([i.filename for i in infos])

    entries: list[tuple[str, zipfile.ZipInfo]] = []
    for info in infos:
        rel = info.filename[len(common_prefix):] if common_prefix else info.filename
        basename = rel.rsplit("/", 1)[-1]
        if not rel or rel.startswith("__MACOSX/") or basename.startswith(".") or basename.lower() in _IGNORED_BASENAMES:
            continue
        try:
            clean_path = normalize_path(rel)
        except InvalidPathError:
            continue
        entries.append((clean_path, info))

    if not entries:
        raise HttpError(400, "No usable files found in the zip.")

    project = Project.objects.create(owner=user, name=clean_name)
    membership = Membership.objects.create(project=project, user=user, role=Role.OWNER)

    for clean_path, info in entries:
        data = zf.read(info)
        file_id = uuid.uuid4()
        key = storage_key_for(project.id, file_id)
        content_type = mimetypes.guess_type(clean_path)[0] or "application/octet-stream"
        storage.put_object(key, data, content_type)
        try:
            ProjectFile.objects.create(
                id=file_id, project=project, path=clean_path, type=guess_file_type(clean_path),
                storage_key=key, size=len(data),
            )
        except IntegrityError:
            storage.delete_object(key)  # duplicate path within the zip — keep the first, skip this one

    return _project_out(project, membership.role)


@router.get("/projects/{project_id}/export")
def export_project_zip(request, project_id: uuid.UUID):
    """Download the project's current files as a .zip — the counterpart to
    /projects/import. Any member can export (same access level as reading
    file content elsewhere); no role restriction. Folders aren't preserved
    as empty entries, mirroring import's own file-only handling."""
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in project.files.exclude(type=FileType.FOLDER):
            zf.writestr(f.path, storage.get_object(f.storage_key))

    safe_name = re.sub(r"[^A-Za-z0-9 ._-]", "_", project.name).strip() or "project"
    response = HttpResponse(buf.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="{safe_name}.zip"'
    return response


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


# --- Members -----------------------------------------------------------


class MemberOut(Schema):
    user_id: uuid.UUID
    display_name: str
    kind: str
    role: str
    is_you: bool


@router.get("/projects/{project_id}/members", response=list[MemberOut])
def list_members(request, project_id: uuid.UUID):
    """Who currently has access and at what level — shown in the Share
    popover (Plan.md §9 Phase 7). Owner-only, same visibility as share-links:
    the Share button that surfaces this is itself only rendered for owners."""
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)

    members = project.memberships.select_related("user").order_by("-role", "created_at")
    return [
        MemberOut(
            user_id=m.user.id,
            display_name=m.user.display_name or m.user.email or m.user.orcid_id or "Anonymous",
            kind=m.user.kind,
            role=m.role,
            is_you=m.user_id == user.id,
        )
        for m in members
    ]


class MemberUpdateIn(Schema):
    role: str


@router.patch("/projects/{project_id}/members/{member_user_id}", response=MemberOut)
def update_member_role(request, project_id: uuid.UUID, member_user_id: uuid.UUID, payload: MemberUpdateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)

    if payload.role not in (Role.OWNER, Role.EDITOR, Role.VIEWER):
        raise HttpError(400, "role must be 'owner', 'editor', or 'viewer'.")

    target = project.memberships.select_related("user").filter(user_id=member_user_id).first()
    if target is None:
        raise HttpError(404, "That user isn't a member of this project.")

    if target.role == Role.OWNER and payload.role != Role.OWNER:
        _require_another_owner_exists(project, exclude_user_id=member_user_id)

    target.role = payload.role
    target.save(update_fields=["role"])
    return MemberOut(
        user_id=target.user.id,
        display_name=target.user.display_name or target.user.email or target.user.orcid_id or "Anonymous",
        kind=target.user.kind,
        role=target.role,
        is_you=target.user_id == user.id,
    )


@router.delete("/projects/{project_id}/members/{member_user_id}")
def remove_member(request, project_id: uuid.UUID, member_user_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER)

    target = project.memberships.filter(user_id=member_user_id).first()
    if target is None:
        raise HttpError(404, "That user isn't a member of this project.")

    if target.role == Role.OWNER:
        _require_another_owner_exists(project, exclude_user_id=member_user_id)

    target.delete()
    return {"detail": "removed"}


def _require_another_owner_exists(project, exclude_user_id) -> None:
    """Guard against demoting/removing the last owner, which would leave
    the project with no one able to manage access, settings, or delete it."""
    remaining_owners = project.memberships.filter(role=Role.OWNER).exclude(user_id=exclude_user_id).exists()
    if not remaining_owners:
        raise HttpError(400, "A project must always have at least one owner.")


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
        token_hash=hash_token(token),
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

    link = ShareLink.objects.filter(token_hash=hash_token(token)).select_related("project").first()
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
