"""Central-`.bib` bootstrap for the Library tab (Plan.md §9 Phase 6).

Entry parsing/editing itself lives client-side (packages/shared/src/bibtex.ts)
over a live Yjs connection to the file — same collab-token/WebSocket path
CodeMirrorEditor already uses (Phase 5), since the central `.bib` is a Yjs
doc so edits merge. This module's only job is making sure a central `.bib`
*file* exists and ProjectSettings points at it, so the frontend has a
file_id to open a collab connection to. Nothing here parses BibTeX or
touches file content after creation.
"""

import uuid

from ninja import Router, Schema

from accounts.auth import SessionAuth
from core import storage
from core.session import get_current_user

from .authz import get_authorized_project
from .compile_api import get_or_create_settings
from .files_api import storage_key_for
from .models import FileType, ProjectFile

router = Router(auth=SessionAuth())

DEFAULT_BIB_PATH = "references.bib"


class BibliographyFileOut(Schema):
    file_id: uuid.UUID
    path: str


@router.get("/projects/{project_id}/bibliography", response=BibliographyFileOut)
def get_bibliography_file(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    settings_row = get_or_create_settings(project)

    path = settings_row.central_bib_path or DEFAULT_BIB_PATH
    bib_file = project.files.filter(path=path).exclude(type=FileType.FOLDER).first()
    if bib_file is None:
        file_id = uuid.uuid4()
        storage.put_object(storage_key_for(project.id, file_id), b"", "text/plain; charset=utf-8")
        bib_file = ProjectFile.objects.create(
            id=file_id, project=project, path=path, type=FileType.BIB,
            storage_key=storage_key_for(project.id, file_id), size=0,
        )

    if settings_row.central_bib_path != path:
        settings_row.central_bib_path = path
        settings_row.save(update_fields=["central_bib_path"])

    return BibliographyFileOut(file_id=bib_file.id, path=bib_file.path)
