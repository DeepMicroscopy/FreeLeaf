"""Version history / snapshots (Plan.md §9 Phase 8): automated + named
checkpoints of a project's full file set, with restore. Each snapshot is a
zip (same format as /export), so diffing or restoring a single file just
means extracting one entry — no per-file delta storage needed at LaTeX
project sizes.
"""

import hashlib
import io
import json
import logging
import mimetypes
import urllib.error
import urllib.request
import uuid
import zipfile

from django.conf import settings as django_settings
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import SessionAuth
from core import storage
from core.session import get_current_user

from .api import build_project_zip_bytes
from .authz import get_authorized_project, require_role
from .compile_api import flush_collab_rooms
from .models import FileType, ProjectFile, ProjectSnapshot, Role, SnapshotKind, touch_project
from .paths import guess_file_type

router = Router(auth=SessionAuth())
logger = logging.getLogger(__name__)

COLLAB_REPLACE_TIMEOUT_SECONDS = 10


def _archive_key_for(project_id, snapshot_id) -> str:
    return f"snapshots/{project_id}/{snapshot_id}.zip"


def _create_snapshot(project, user, kind: str, label: str = "", description: str = "") -> ProjectSnapshot | None:
    """Returns None (no-op) for an automatic snapshot whose content is
    identical to the most recent snapshot — avoids junk checkpoints when the
    inactivity timer fires with nothing new to capture."""
    flush_collab_rooms(project)
    archive_bytes = build_project_zip_bytes(project)
    content_hash = hashlib.sha256(archive_bytes).hexdigest()

    if kind == SnapshotKind.AUTO:
        latest = project.snapshots.first()
        if latest is not None and latest.content_hash == content_hash:
            return None

    snapshot_id = uuid.uuid4()
    key = _archive_key_for(project.id, snapshot_id)
    storage.put_object(key, archive_bytes, "application/zip")
    return ProjectSnapshot.objects.create(
        id=snapshot_id,
        project=project,
        created_by=user,
        kind=kind,
        label=label,
        description=description,
        archive_key=key,
        content_hash=content_hash,
    )


def _replace_collab_content(file_id: uuid.UUID, content: str) -> bool:
    """True if collab handled the write (live room replaced, or persisted
    directly if no room was open); False if collab was unreachable, in
    which case the caller should fall back to writing storage directly."""
    url = f"{django_settings.COLLAB_INTERNAL_URL}/replace/{file_id}"
    request = urllib.request.Request(
        url,
        data=json.dumps({"content": content}).encode(),
        method="POST",
        headers={"X-Collab-Secret": django_settings.COLLAB_SHARED_SECRET, "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=COLLAB_REPLACE_TIMEOUT_SECONDS)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        logger.warning("collab replace failed for file %s: %s", file_id, exc)
        return False


class SnapshotOut(Schema):
    id: uuid.UUID
    kind: str
    label: str
    description: str
    created_at: str
    created_by_name: str | None = None


def _snapshot_out(s: ProjectSnapshot) -> SnapshotOut:
    return SnapshotOut(
        id=s.id,
        kind=s.kind,
        label=s.label,
        description=s.description,
        created_at=s.created_at.isoformat(),
        created_by_name=(s.created_by.display_name or s.created_by.email or s.created_by.orcid_id)
        if s.created_by
        else None,
    )


class SnapshotCreateIn(Schema):
    kind: str = SnapshotKind.MANUAL
    label: str = ""
    description: str = ""


@router.post("/projects/{project_id}/snapshots", response=SnapshotOut)
def create_snapshot(request, project_id: uuid.UUID, payload: SnapshotCreateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)

    if payload.kind not in (SnapshotKind.AUTO, SnapshotKind.MANUAL):
        raise HttpError(400, "kind must be 'auto' or 'manual'.")

    snapshot = _create_snapshot(project, user, payload.kind, payload.label.strip(), payload.description.strip())
    if snapshot is None:
        # Nothing changed since the last snapshot — return that one instead
        # of silently doing nothing, so the frontend has something to show.
        snapshot = project.snapshots.first()
    return _snapshot_out(snapshot)


@router.get("/projects/{project_id}/snapshots", response=list[SnapshotOut])
def list_snapshots(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    return [_snapshot_out(s) for s in project.snapshots.select_related("created_by")]


def _get_snapshot_or_404(project, snapshot_id: uuid.UUID) -> ProjectSnapshot:
    snapshot = project.snapshots.filter(id=snapshot_id).first()
    if snapshot is None:
        raise HttpError(404, "Snapshot not found.")
    return snapshot


def _read_archive_entry(snapshot: ProjectSnapshot, path: str) -> bytes | None:
    archive_bytes = storage.get_object(snapshot.archive_key)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
        try:
            return zf.read(path)
        except KeyError:
            return None


class SnapshotFileOut(Schema):
    content: str


@router.get("/projects/{project_id}/snapshots/{snapshot_id}/file-content", response=SnapshotFileOut)
def get_snapshot_file_content(request, project_id: uuid.UUID, snapshot_id: uuid.UUID, path: str):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    snapshot = _get_snapshot_or_404(project, snapshot_id)

    content_bytes = _read_archive_entry(snapshot, path)
    if content_bytes is None:
        raise HttpError(404, "That file doesn't exist in this snapshot.")
    return SnapshotFileOut(content=content_bytes.decode(errors="replace"))


class RestoreOut(Schema):
    restored_to: SnapshotOut
    safety_snapshot: SnapshotOut | None = None


@router.post("/projects/{project_id}/snapshots/{snapshot_id}/restore", response=RestoreOut)
def restore_snapshot(request, project_id: uuid.UUID, snapshot_id: uuid.UUID):
    """Makes the project's files match the target snapshot exactly:
    existing files are overwritten, files missing since the snapshot are
    recreated, and files that didn't exist at snapshot time are deleted.
    A safety snapshot of the *current* state is taken first — nothing is
    ever truly lost, since restoring is itself always just a restore away.
    """
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    target = _get_snapshot_or_404(project, snapshot_id)

    safety_snapshot = _create_snapshot(
        project, user, SnapshotKind.AUTO, description=f"Automatic backup before restoring to {target.created_at:%Y-%m-%d %H:%M}"
    )

    archive_bytes = storage.get_object(target.archive_key)
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as zf:
        target_paths = set(zf.namelist())
        existing_by_path = {f.path: f for f in project.files.exclude(type=FileType.FOLDER)}

        for path in target_paths:
            content_bytes = zf.read(path)
            existing = existing_by_path.get(path)
            if existing is not None:
                if existing.type in (FileType.TEX, FileType.BIB):
                    handled = _replace_collab_content(existing.id, content_bytes.decode(errors="replace"))
                    if not handled:
                        storage.put_object(existing.storage_key, content_bytes, "text/plain; charset=utf-8")
                else:
                    content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
                    storage.put_object(existing.storage_key, content_bytes, content_type)
                existing.size = len(content_bytes)
                existing.save(update_fields=["size", "updated_at"])
            else:
                file_id = uuid.uuid4()
                key = f"projects/{project.id}/{file_id}"
                content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
                storage.put_object(key, content_bytes, content_type)
                ProjectFile.objects.create(
                    id=file_id, project=project, path=path, type=guess_file_type(path),
                    storage_key=key, size=len(content_bytes),
                )

        for path, f in existing_by_path.items():
            if path not in target_paths:
                storage.delete_object(f.storage_key)
                f.delete()

    touch_project(project, user)
    return RestoreOut(
        restored_to=_snapshot_out(target),
        safety_snapshot=_snapshot_out(safety_snapshot) if safety_snapshot else None,
    )
