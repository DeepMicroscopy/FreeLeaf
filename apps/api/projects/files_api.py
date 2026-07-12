import mimetypes
import uuid

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.auth import SessionAuth
from core import storage
from core.session import get_current_user

from .authz import get_authorized_project, require_role
from .models import FileType, ProjectFile, Role, touch_project
from .paths import InvalidPathError, guess_file_type, normalize_path

router = Router(auth=SessionAuth())

MAX_TEXT_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_UPLOAD_BYTES = 15 * 1024 * 1024  # 15 MB

DEFAULT_MAIN_TEX = """\\documentclass{article}
\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\end{document}
"""


def storage_key_for(project_id, file_id) -> str:
    return f"projects/{project_id}/{file_id}"


class ProjectFileOut(Schema):
    id: uuid.UUID
    path: str
    type: str
    size: int
    created_at: str
    updated_at: str


def _file_out(f: ProjectFile) -> ProjectFileOut:
    return ProjectFileOut(
        id=f.id, path=f.path, type=f.type, size=f.size,
        created_at=f.created_at.isoformat(), updated_at=f.updated_at.isoformat(),
    )


def create_main_tex(project) -> ProjectFile:
    content = DEFAULT_MAIN_TEX.encode()
    file_id = uuid.uuid4()
    storage.put_object(storage_key_for(project.id, file_id), content, "text/plain; charset=utf-8")
    return ProjectFile.objects.create(
        id=file_id, project=project, path="main.tex", type=FileType.TEX,
        storage_key=storage_key_for(project.id, file_id), size=len(content),
    )


@router.get("/projects/{project_id}/files", response=list[ProjectFileOut])
def list_files(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    files = project.files.order_by("path")
    return [_file_out(f) for f in files]


class FileCreateIn(Schema):
    path: str
    content: str = ""


@router.post("/projects/{project_id}/files", response=ProjectFileOut)
def create_file(request, project_id: uuid.UUID, payload: FileCreateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)

    try:
        path = normalize_path(payload.path)
    except InvalidPathError as exc:
        raise HttpError(400, str(exc)) from exc

    content_bytes = payload.content.encode()
    if len(content_bytes) > MAX_TEXT_BYTES:
        raise HttpError(413, "File is too large.")

    file_type = guess_file_type(path)
    file_id = uuid.uuid4()
    key = storage_key_for(project_id, file_id)
    storage.put_object(key, content_bytes, "text/plain; charset=utf-8")

    try:
        with transaction.atomic():
            f = ProjectFile.objects.create(
                id=file_id, project=project, path=path, type=file_type,
                storage_key=key, size=len(content_bytes),
            )
    except IntegrityError as exc:
        storage.delete_object(key)
        raise HttpError(409, "A file already exists at that path.") from exc
    touch_project(project, user)
    return _file_out(f)


class FolderCreateIn(Schema):
    path: str


@router.post("/projects/{project_id}/folders", response=ProjectFileOut)
def create_folder(request, project_id: uuid.UUID, payload: FolderCreateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)

    try:
        path = normalize_path(payload.path)
    except InvalidPathError as exc:
        raise HttpError(400, str(exc)) from exc

    try:
        f = ProjectFile.objects.create(
            id=uuid.uuid4(), project=project, path=path, type=FileType.FOLDER,
            storage_key=None, size=0,
        )
    except IntegrityError as exc:
        raise HttpError(409, "A file or folder already exists at that path.") from exc
    touch_project(project, user)
    return _file_out(f)


@router.post("/projects/{project_id}/files/upload", response=ProjectFileOut)
def upload_file(request, project_id: uuid.UUID, path: str, file: UploadedFile = File(...)):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)

    try:
        clean_path = normalize_path(path)
    except InvalidPathError as exc:
        raise HttpError(400, str(exc)) from exc

    data = file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HttpError(413, "File is too large.")

    file_type = guess_file_type(clean_path)
    content_type = file.content_type or mimetypes.guess_type(clean_path)[0] or "application/octet-stream"
    file_id = uuid.uuid4()
    key = storage_key_for(project_id, file_id)
    storage.put_object(key, data, content_type)

    try:
        f = ProjectFile.objects.create(
            id=file_id, project=project, path=clean_path, type=file_type,
            storage_key=key, size=len(data),
        )
    except IntegrityError as exc:
        storage.delete_object(key)
        raise HttpError(409, "A file already exists at that path.") from exc
    touch_project(project, user)
    return _file_out(f)


# NOTE: registration order matters — Django's URL resolver matches path
# templates in declaration order, and ninja doesn't type-prefix path
# converters (e.g. {file_id} becomes a generic <file_id>, not <uuid:file_id>).
# The literal "/files/upload" segment above must be registered before the
# "/files/{file_id}" routes below, or a POST to /files/upload would match
# the (file_id="upload") pattern first and 405 (that pattern has no POST).


def _get_file_or_404(project, file_id) -> ProjectFile:
    f = project.files.filter(id=file_id).first()
    if f is None:
        raise HttpError(404, "File not found.")
    return f


@router.get("/projects/{project_id}/files/{file_id}/content")
def get_file_content(request, project_id: uuid.UUID, file_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    f = _get_file_or_404(project, file_id)
    if f.type == FileType.FOLDER:
        raise HttpError(400, "Folders have no content.")
    data = storage.get_object(f.storage_key)
    content_type = mimetypes.guess_type(f.path)[0] or "application/octet-stream"
    return HttpResponse(data, content_type=content_type)


class FileContentIn(Schema):
    content: str


@router.put("/projects/{project_id}/files/{file_id}/content", response=ProjectFileOut)
def update_file_content(request, project_id: uuid.UUID, file_id: uuid.UUID, payload: FileContentIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    f = _get_file_or_404(project, file_id)
    if f.type == FileType.FOLDER:
        raise HttpError(400, "Folders have no content.")

    content_bytes = payload.content.encode()
    if len(content_bytes) > MAX_TEXT_BYTES:
        raise HttpError(413, "File is too large.")

    storage.put_object(f.storage_key, content_bytes, "text/plain; charset=utf-8")
    f.size = len(content_bytes)
    f.save(update_fields=["size", "updated_at"])
    touch_project(project, user)
    return _file_out(f)


class FileRenameIn(Schema):
    path: str


@router.patch("/projects/{project_id}/files/{file_id}", response=ProjectFileOut)
def rename_file(request, project_id: uuid.UUID, file_id: uuid.UUID, payload: FileRenameIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    f = _get_file_or_404(project, file_id)

    try:
        new_path = normalize_path(payload.path)
    except InvalidPathError as exc:
        raise HttpError(400, str(exc)) from exc

    old_prefix = f.path + "/"
    try:
        with transaction.atomic():
            if f.type == FileType.FOLDER:
                descendants = list(project.files.filter(path__startswith=old_prefix))
                for d in descendants:
                    d.path = new_path + d.path[len(f.path):]
                ProjectFile.objects.bulk_update(descendants, ["path"])
            f.path = new_path
            f.save(update_fields=["path", "updated_at"])
    except IntegrityError as exc:
        raise HttpError(409, "A file already exists at that path.") from exc
    touch_project(project, user)
    return _file_out(f)


@router.delete("/projects/{project_id}/files/{file_id}")
def delete_file(request, project_id: uuid.UUID, file_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    f = _get_file_or_404(project, file_id)

    to_delete = [f]
    if f.type == FileType.FOLDER:
        to_delete.extend(project.files.filter(path__startswith=f.path + "/"))

    keys = [d.storage_key for d in to_delete if d.storage_key]
    ids = [d.id for d in to_delete]
    ProjectFile.objects.filter(id__in=ids).delete()
    for key in keys:
        storage.delete_object(key)
    touch_project(project, user)
    return {"detail": "deleted"}
