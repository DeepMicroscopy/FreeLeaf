import logging
import time
import uuid

from django.conf import settings
from django.http import JsonResponse
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import SessionAuth
from accounts.models import User
from core import storage
from core.collab_tokens import sign_collab_token
from core.session import get_current_user

from .authz import get_authorized_project
from .models import FileType, ProjectFile, touch_project

logger = logging.getLogger(__name__)

router = Router(auth=SessionAuth())

COLLAB_TOKEN_TTL_SECONDS = 60  # only needs to live long enough to open the WS connection


class CollabTokenOut(Schema):
    token: str
    ws_url: str


@router.get("/projects/{project_id}/files/{file_id}/collab-token", response=CollabTokenOut)
def get_collab_token(request, project_id: uuid.UUID, file_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    f = project.files.filter(id=file_id).first()
    if f is None:
        raise HttpError(404, "File not found.")
    if f.type == FileType.FOLDER:
        raise HttpError(400, "Folders aren't collaborative documents.")

    now = time.time()
    payload = {
        "project_id": str(project_id),
        "file_id": str(file_id),
        "user_id": str(user.id),
        "display_name": user.display_name or "Anonymous",
        "role": membership.role,
        "exp": now + COLLAB_TOKEN_TTL_SECONDS,
    }
    token = sign_collab_token(payload, settings.COLLAB_SHARED_SECRET)
    logger.info(
        "collab-token issued: project=%s file=%s user=%s role=%s issued_at=%.3f exp=%.3f "
        "ttl=%ss ws_url=%s secret_len=%s secret_prefix=%s",
        project_id, file_id, user.id, membership.role, now, payload["exp"],
        COLLAB_TOKEN_TTL_SECONDS, settings.COLLAB_WS_URL,
        len(settings.COLLAB_SHARED_SECRET), settings.COLLAB_SHARED_SECRET[:4],
    )
    return CollabTokenOut(token=token, ws_url=settings.COLLAB_WS_URL)


# --- Internal, service-to-service surface for apps/collab. Not user-session
# authenticated (the collab service has no session/cookie of its own) —
# protected instead by a shared-secret header, same trust model as a
# webhook. Deliberately a bare Django view, not a ninja Router(auth=...),
# since there's no per-user identity to check here, only the service secret.


def _check_internal_secret(request) -> None:
    provided = request.headers.get("X-Collab-Secret", "")
    expected = settings.COLLAB_SHARED_SECRET
    if not provided or provided != expected:
        logger.warning(
            "internal collab request rejected: provided_len=%s provided_prefix=%s "
            "expected_len=%s expected_prefix=%s path=%s",
            len(provided), provided[:4], len(expected), expected[:4], request.path,
        )
        raise HttpError(401, "Invalid collab service secret.")


internal_router = Router()


@internal_router.get("/internal/collab/files/{file_id}/content")
def internal_get_content(request, file_id: uuid.UUID):
    _check_internal_secret(request)
    f = _internal_file_or_404(file_id)
    return JsonResponse({"content": storage.get_object(f.storage_key).decode(errors="replace")})


class InternalContentIn(Schema):
    content: str
    # Best-effort — whichever connected user's edit the collab server saw
    # most recently before this flush, not a full authorship history.
    editor_user_id: str | None = None


@internal_router.put("/internal/collab/files/{file_id}/content")
def internal_put_content(request, file_id: uuid.UUID, payload: InternalContentIn):
    _check_internal_secret(request)
    f = _internal_file_or_404(file_id)
    content_bytes = payload.content.encode()
    storage.put_object(f.storage_key, content_bytes, "text/plain; charset=utf-8")
    f.size = len(content_bytes)
    f.save(update_fields=["size", "updated_at"])
    editor = User.objects.filter(id=payload.editor_user_id).first() if payload.editor_user_id else None
    touch_project(f.project, editor)
    return {"ok": True}


def _internal_file_or_404(file_id: uuid.UUID):
    f = ProjectFile.objects.filter(id=file_id).exclude(type=FileType.FOLDER).first()
    if f is None:
        raise HttpError(404, "File not found.")
    return f
