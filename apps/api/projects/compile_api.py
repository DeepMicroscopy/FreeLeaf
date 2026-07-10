import base64
import io
import json
import logging
import os
import tarfile
import urllib.error
import urllib.request
import uuid
from urllib.parse import quote

from django.conf import settings as django_settings
from django.http import HttpResponse
from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import SessionAuth
from core import storage
from core.session import get_current_user

from .authz import get_authorized_project, require_role
from .log_parser import Diagnostic, parse_log
from .models import BibEngine, Compiler, CompileRun, FileType, ProjectSettings, Role
from .paths import InvalidPathError, normalize_path

logger = logging.getLogger(__name__)

router = Router(auth=SessionAuth())

COMPILE_SERVICE_URL = os.environ.get("COMPILE_SERVICE_URL", "http://compile:8100")
COMPILE_REQUEST_TIMEOUT_SECONDS = 90  # sandbox's own wall-clock cap is 60s; leave headroom
COLLAB_FLUSH_TIMEOUT_SECONDS = 5


def get_or_create_settings(project) -> ProjectSettings:
    settings_row, _ = ProjectSettings.objects.get_or_create(project=project)
    return settings_row


def flush_collab_rooms(project) -> None:
    """Force any open Yjs collab room (Phase 5) for this project's files to
    persist its in-memory state to storage *right now*, before we read that
    storage for a compile. Without this, a file being actively co-edited only
    reflects storage as of its last periodic flush (up to a few seconds
    stale) or its last client disconnecting — compiling in that gap silently
    uses old content. Found via a real report: a document's `\\bibliography{}`
    target had just been edited, but the compiled log showed latexmk
    searching for the *previous* filename, because the compile ran against
    pre-edit storage. No-op per file if no room is currently open for it
    (collab reports `flushed: false`; storage was already authoritative)."""
    for f in project.files.exclude(type=FileType.FOLDER):
        url = f"{django_settings.COLLAB_INTERNAL_URL}/flush/{f.id}"
        request = urllib.request.Request(
            url, method="POST", headers={"X-Collab-Secret": django_settings.COLLAB_SHARED_SECRET}
        )
        try:
            urllib.request.urlopen(request, timeout=COLLAB_FLUSH_TIMEOUT_SECONDS)
        except (urllib.error.URLError, urllib.error.HTTPError) as exc:
            # Best-effort: if collab is unreachable, compile against whatever
            # storage already has rather than failing the whole compile.
            logger.warning("collab flush failed for file %s: %s", f.id, exc)


def materialize_tar(project) -> bytes:
    """Bundle the project's current file content into an in-memory tar for
    the compile service. Storage keys are opaque server-generated ids
    (see files_api.py); `path` is what's already been validated against
    path traversal at file-creation time — reused here as the tar member
    name so the compiled document sees the same tree the editor shows."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for f in project.files.exclude(type=FileType.FOLDER):
            data = storage.get_object(f.storage_key)
            info = tarfile.TarInfo(name=f.path)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def dispatch_compile(tar_bytes: bytes, compiler: str, main_file: str) -> dict:
    url = f"{COMPILE_SERVICE_URL}/compile?compiler={quote(compiler)}&main={quote(main_file)}"
    request = urllib.request.Request(
        url, data=tar_bytes, method="POST", headers={"Content-Type": "application/x-tar"}
    )
    try:
        with urllib.request.urlopen(request, timeout=COMPILE_REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise HttpError(400, f"Compile request rejected: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HttpError(502, "Compile service is unavailable.") from exc


def _dispatch_synctex(path: str, body: dict) -> dict | None:
    request = urllib.request.Request(
        f"{COMPILE_SERVICE_URL}{path}",
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=COMPILE_REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        detail = exc.read().decode(errors="replace")
        raise HttpError(400, f"SyncTeX request rejected: {detail}") from exc
    except urllib.error.URLError as exc:
        raise HttpError(502, "Compile service is unavailable.") from exc


class ProjectSettingsOut(Schema):
    main_doc_path: str
    central_bib_path: str | None = None
    compiler: str
    bib_engine: str
    cite_autocomplete_enabled: bool


def _settings_out(s: ProjectSettings) -> ProjectSettingsOut:
    return ProjectSettingsOut(
        main_doc_path=s.main_doc_path,
        central_bib_path=s.central_bib_path,
        compiler=s.compiler,
        bib_engine=s.bib_engine,
        cite_autocomplete_enabled=s.cite_autocomplete_enabled,
    )


@router.get("/projects/{project_id}/settings", response=ProjectSettingsOut)
def get_settings(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    return _settings_out(get_or_create_settings(project))


class ProjectSettingsIn(Schema):
    main_doc_path: str | None = None
    central_bib_path: str | None = None
    compiler: str | None = None
    bib_engine: str | None = None
    cite_autocomplete_enabled: bool | None = None


@router.patch("/projects/{project_id}/settings", response=ProjectSettingsOut)
def update_settings(request, project_id: uuid.UUID, payload: ProjectSettingsIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    s = get_or_create_settings(project)

    if payload.compiler is not None:
        if payload.compiler not in (Compiler.PDFLATEX, Compiler.XELATEX):
            raise HttpError(400, "compiler must be 'pdflatex' or 'xelatex'.")
        s.compiler = payload.compiler
    if payload.bib_engine is not None:
        if payload.bib_engine not in (BibEngine.BIBTEX, BibEngine.BIBER):
            raise HttpError(400, "bib_engine must be 'bibtex' or 'biber'.")
        s.bib_engine = payload.bib_engine
    if payload.cite_autocomplete_enabled is not None:
        s.cite_autocomplete_enabled = payload.cite_autocomplete_enabled
    if payload.main_doc_path is not None:
        try:
            s.main_doc_path = normalize_path(payload.main_doc_path)
        except InvalidPathError as exc:
            raise HttpError(400, str(exc)) from exc
    if payload.central_bib_path is not None:
        try:
            s.central_bib_path = normalize_path(payload.central_bib_path) if payload.central_bib_path else None
        except InvalidPathError as exc:
            raise HttpError(400, str(exc)) from exc

    s.save()
    return _settings_out(s)


class DiagnosticOut(Schema):
    message: str
    file: str | None = None
    line: int | None = None


class CompileRunOut(Schema):
    id: uuid.UUID
    compiler: str
    status: str
    started_at: str
    finished_at: str | None = None
    exit_code: int | None = None
    duration_ms: int | None = None
    has_pdf: bool
    errors: list[DiagnosticOut]
    warnings: list[DiagnosticOut]


def _run_out(run: CompileRun) -> CompileRunOut:
    return CompileRunOut(
        id=run.id,
        compiler=run.compiler,
        status=run.status,
        started_at=run.started_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        exit_code=run.exit_code,
        duration_ms=run.duration_ms,
        has_pdf=bool(run.pdf_key),
        errors=run.errors,
        warnings=run.warnings,
    )


def _diagnostic_dicts(diagnostics: list[Diagnostic]) -> list[dict]:
    return [{"message": d.message, "file": d.file, "line": d.line} for d in diagnostics]


@router.post("/projects/{project_id}/compile", response=CompileRunOut)
def trigger_compile(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)

    settings_row = get_or_create_settings(project)
    flush_collab_rooms(project)
    tar_bytes = materialize_tar(project)
    result = dispatch_compile(tar_bytes, settings_row.compiler, settings_row.main_doc_path)

    run_id = uuid.uuid4()
    pdf_key = None
    if result.get("pdf_base64"):
        pdf_key = f"compiles/{project_id}/{run_id}.pdf"
        storage.put_object(pdf_key, base64.b64decode(result["pdf_base64"]), "application/pdf")

    log_text = result.get("log") or ""
    log_key = f"compiles/{project_id}/{run_id}.log"
    storage.put_object(log_key, log_text.encode(), "text/plain; charset=utf-8")
    parsed_log = parse_log(log_text)

    synctex_key = None
    if result.get("synctex_base64"):
        synctex_key = f"compiles/{project_id}/{run_id}.synctex.gz"
        storage.put_object(synctex_key, base64.b64decode(result["synctex_base64"]), "application/gzip")

    run = CompileRun.objects.create(
        id=run_id,
        project=project,
        compiler=result.get("compiler", settings_row.compiler),
        status=result["status"],
        finished_at=timezone.now(),
        pdf_key=pdf_key,
        log_key=log_key,
        synctex_key=synctex_key,
        exit_code=result.get("exit_code"),
        duration_ms=result.get("duration_ms"),
        errors=_diagnostic_dicts(parsed_log.errors),
        warnings=_diagnostic_dicts(parsed_log.warnings),
    )
    return _run_out(run)


@router.get("/projects/{project_id}/compile-runs", response=list[CompileRunOut])
def list_compile_runs(request, project_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    return [_run_out(r) for r in project.compile_runs.all()[:20]]


@router.get("/projects/{project_id}/compile-runs/{run_id}/pdf")
def get_compile_pdf(request, project_id: uuid.UUID, run_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    run = project.compile_runs.filter(id=run_id).first()
    if not run or not run.pdf_key:
        raise HttpError(404, "No PDF for this compile run.")
    return HttpResponse(storage.get_object(run.pdf_key), content_type="application/pdf")


@router.get("/projects/{project_id}/compile-runs/{run_id}/log")
def get_compile_log(request, project_id: uuid.UUID, run_id: uuid.UUID):
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    run = project.compile_runs.filter(id=run_id).first()
    if not run or not run.log_key:
        raise HttpError(404, "No log for this compile run.")
    return HttpResponse(storage.get_object(run.log_key), content_type="text/plain; charset=utf-8")


class SyncTexForwardOut(Schema):
    page: int
    x: float
    y: float
    h: float
    v: float
    width: float
    height: float


@router.get("/projects/{project_id}/compile-runs/{run_id}/synctex/forward", response=SyncTexForwardOut)
def synctex_forward(request, project_id: uuid.UUID, run_id: uuid.UUID, file: str, line: int):
    """Source position -> PDF position, for jumping the PDF pane to match
    the editor cursor ("both ways" click-to-source, Plan.md §9 Phase 7)."""
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    run = project.compile_runs.filter(id=run_id).first()
    if not run or not run.pdf_key or not run.synctex_key:
        raise HttpError(404, "No SyncTeX data for this compile run.")

    body = {
        "pdf_base64": base64.b64encode(storage.get_object(run.pdf_key)).decode(),
        "synctex_base64": base64.b64encode(storage.get_object(run.synctex_key)).decode(),
        "file": file,
        "line": line,
    }
    result = _dispatch_synctex("/synctex/forward", body)
    if result is None:
        raise HttpError(404, "No SyncTeX record for that position.")
    return SyncTexForwardOut(**result)


class SyncTexBackwardOut(Schema):
    file: str
    line: int
    column: int


@router.get("/projects/{project_id}/compile-runs/{run_id}/synctex/backward", response=SyncTexBackwardOut)
def synctex_backward(request, project_id: uuid.UUID, run_id: uuid.UUID, page: int, x: float, y: float):
    """PDF position -> source position, for jumping the editor to match a
    click in the PDF pane."""
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    run = project.compile_runs.filter(id=run_id).first()
    if not run or not run.pdf_key or not run.synctex_key:
        raise HttpError(404, "No SyncTeX data for this compile run.")

    body = {
        "pdf_base64": base64.b64encode(storage.get_object(run.pdf_key)).decode(),
        "synctex_base64": base64.b64encode(storage.get_object(run.synctex_key)).decode(),
        "page": page,
        "x": x,
        "y": y,
    }
    result = _dispatch_synctex("/synctex/backward", body)
    if result is None:
        raise HttpError(404, "No SyncTeX record for that position.")
    return SyncTexBackwardOut(**result)
