"""Template gallery + GitHub-repo project creation (Plan.md §9 extension).

A Template is just a stored zip blob + metadata; creating a project "from"
one reuses exactly the same validated import path a manual zip upload goes
through (`_create_project_from_zip_bytes`, projects/api.py) — no separate
LaTeX-aware logic needed here at all.
"""

import io
import os
import re
import urllib.error
import urllib.request
import uuid
import zipfile

from ninja import File, Router, Schema
from ninja.errors import HttpError
from ninja.files import UploadedFile

from accounts.admin_api import require_admin
from accounts.auth import SessionAuth
from accounts.models import SiteSettings, User
from core import storage
from core.session import get_current_user

from .api import MAX_ZIP_BYTES, ProjectOut, _create_project_from_zip_bytes, _project_out
from .models import Role, Template

router = Router(auth=SessionAuth())

GITHUB_FETCH_TIMEOUT_SECONDS = 30

# GitHub's actual username/repo-name character rules (alphanumerics, dots,
# underscores, hyphens; can't start with one of the punctuation chars) —
# validated *before* any URL is built. Combined with the fixed hardcoded
# host below, this is the whole SSRF defense: owner/repo can never contain
# "/" (so no path traversal into a different API route) and the request
# never goes anywhere the user could redirect it to.
_GITHUB_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def _require_signed_in_non_anonymous(request) -> User:
    user = get_current_user(request)
    if user is None:
        raise HttpError(401, "Authentication required.")
    if user.kind == User.Kind.ANONYMOUS:
        raise HttpError(403, "Anonymous users can't create projects — sign in with ORCID or email.")
    return user


def _fetch_github_zip(owner: str, repo: str) -> bytes:
    if not _GITHUB_NAME_RE.match(owner) or not _GITHUB_NAME_RE.match(repo):
        raise HttpError(400, "That doesn't look like a valid GitHub owner/repo name.")

    # api.github.com is a fixed, hardcoded host — never derived from user
    # input. This one call also resolves the repo's actual default branch
    # automatically, no separate lookup needed.
    url = f"https://api.github.com/repos/{owner}/{repo}/zipball"
    headers = {"User-Agent": "FreeLeaf", "Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=GITHUB_FETCH_TIMEOUT_SECONDS) as response:
            # Bounded read regardless of what Content-Length claims — caps
            # memory use even against an adversarial/misreporting response.
            data = response.read(MAX_ZIP_BYTES + 1)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise HttpError(404, "That GitHub repository wasn't found (it may be private, or doesn't exist).") from exc
        if exc.code == 403:
            raise HttpError(502, "GitHub rate-limited this request — try again in a bit.") from exc
        raise HttpError(502, f"GitHub returned an error ({exc.code}).") from exc
    except urllib.error.URLError as exc:
        raise HttpError(502, "Could not reach GitHub.") from exc

    if len(data) > MAX_ZIP_BYTES:
        raise HttpError(413, "That repository is too large to import.")
    return data


class FromTemplateIn(Schema):
    name: str


@router.post("/projects/from-template/{template_id}", response=ProjectOut)
def create_project_from_template(request, template_id: uuid.UUID, payload: FromTemplateIn):
    user = _require_signed_in_non_anonymous(request)
    clean_name = payload.name.strip()
    if not clean_name:
        raise HttpError(400, "Project name is required.")

    template = Template.objects.filter(id=template_id, is_published=True).first()
    if template is None:
        raise HttpError(404, "Template not found.")

    zip_bytes = storage.get_object(template.zip_storage_key)
    project = _create_project_from_zip_bytes(user, clean_name, zip_bytes)
    return _project_out(project, Role.OWNER)


class FromGithubIn(Schema):
    name: str
    owner: str
    repo: str


@router.post("/projects/from-github", response=ProjectOut)
def create_project_from_github(request, payload: FromGithubIn):
    user = _require_signed_in_non_anonymous(request)
    clean_name = payload.name.strip()
    if not clean_name:
        raise HttpError(400, "Project name is required.")

    zip_bytes = _fetch_github_zip(payload.owner.strip(), payload.repo.strip())
    project = _create_project_from_zip_bytes(user, clean_name, zip_bytes)
    return _project_out(project, Role.OWNER)


class TemplateOut(Schema):
    id: uuid.UUID
    name: str
    description: str
    source_url: str
    category: str
    is_published: bool
    created_at: str


def _template_out(t: Template) -> TemplateOut:
    return TemplateOut(
        id=t.id,
        name=t.name,
        description=t.description,
        source_url=t.source_url,
        category=t.category,
        is_published=t.is_published,
        created_at=t.created_at.isoformat(),
    )


@router.get("/templates", response=list[TemplateOut])
def list_templates(request):
    _require_signed_in_non_anonymous(request)
    return [_template_out(t) for t in Template.objects.filter(is_published=True).order_by("name")]


@router.get("/templates/all", response=list[TemplateOut])
def list_all_templates(request):
    """Admin template management (Plan.md §9 extension) — every template
    regardless of publish status, so the admin panel can edit/delete/
    publish anything, not just review pending submissions."""
    require_admin(get_current_user(request))
    return [_template_out(t) for t in Template.objects.all().order_by("-created_at")]


def _template_storage_key(template_id, suffix: str) -> str:
    return f"templates/{template_id}/{suffix}"


@router.post("/templates", response=TemplateOut)
def create_template(
    request,
    name: str,
    source_url: str,
    description: str = "",
    category: str = "",
    file: UploadedFile = File(...),
):
    user = get_current_user(request)
    if user is None:
        raise HttpError(401, "Authentication required.")
    if user.kind == User.Kind.ANONYMOUS:
        raise HttpError(403, "Anonymous users can't contribute templates — sign in with ORCID or email.")

    mode = SiteSettings.load().template_contribution_mode
    if mode == SiteSettings.TemplateContributionMode.ADMIN_ONLY:
        require_admin(user)

    clean_name = name.strip()
    if not clean_name:
        raise HttpError(400, "Template name is required.")
    clean_url = source_url.strip()
    if not clean_url:
        raise HttpError(400, "A source URL is required, so contributors are credited and the template is traceable.")

    zip_bytes = file.read()
    if len(zip_bytes) > MAX_ZIP_BYTES:
        raise HttpError(413, "Zip file is too large.")
    # Fail fast on an unusable zip before writing anything to storage —
    # cheap to construct, and _create_project_from_zip_bytes does the exact
    # same validation later when the template is actually used, so this
    # just surfaces the error at contribution time instead of first-use time.
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
        bad = zf.testzip()
        if bad is not None:
            raise HttpError(400, f"Corrupt entry in zip: {bad}")
    except zipfile.BadZipFile as exc:
        raise HttpError(400, "That doesn't look like a valid .zip file.") from exc

    template_id = uuid.uuid4()
    zip_key = _template_storage_key(template_id, "zip")
    storage.put_object(zip_key, zip_bytes, "application/zip")

    is_published = mode != SiteSettings.TemplateContributionMode.REVIEW_REQUIRED

    template = Template.objects.create(
        id=template_id,
        name=clean_name,
        description=description.strip(),
        source_url=clean_url,
        category=category.strip(),
        zip_storage_key=zip_key,
        created_by=user,
        is_published=is_published,
    )
    return _template_out(template)


class TemplateUpdateIn(Schema):
    name: str | None = None
    description: str | None = None
    source_url: str | None = None
    category: str | None = None
    is_published: bool | None = None


@router.patch("/templates/{template_id}", response=TemplateOut)
def update_template(request, template_id: uuid.UUID, payload: TemplateUpdateIn):
    require_admin(get_current_user(request))
    template = Template.objects.filter(id=template_id).first()
    if template is None:
        raise HttpError(404, "Template not found.")

    update_fields = []
    if payload.name is not None:
        clean_name = payload.name.strip()
        if not clean_name:
            raise HttpError(400, "Template name can't be blank.")
        template.name = clean_name
        update_fields.append("name")
    if payload.description is not None:
        template.description = payload.description.strip()
        update_fields.append("description")
    if payload.source_url is not None:
        clean_url = payload.source_url.strip()
        if not clean_url:
            raise HttpError(400, "Source URL can't be blank.")
        template.source_url = clean_url
        update_fields.append("source_url")
    if payload.category is not None:
        template.category = payload.category.strip()
        update_fields.append("category")
    if payload.is_published is not None:
        template.is_published = payload.is_published
        update_fields.append("is_published")

    if update_fields:
        template.save(update_fields=[*update_fields, "updated_at"])
    return _template_out(template)


@router.delete("/templates/{template_id}")
def delete_template(request, template_id: uuid.UUID):
    require_admin(get_current_user(request))
    template = Template.objects.filter(id=template_id).first()
    if template is None:
        raise HttpError(404, "Template not found.")
    storage.delete_object(template.zip_storage_key)
    template.delete()
    return {"detail": "Template deleted."}
