import uuid

from django.db import models

from accounts.models import User


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    EDITOR = "editor", "Editor"
    VIEWER = "viewer", "Viewer"


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_projects"
    )
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    id = models.BigAutoField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=16, choices=Role.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "user"], name="unique_membership_per_project_user"),
        ]

    def __str__(self):
        return f"{self.user_id} in {self.project_id} as {self.role}"


class ShareLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="share_links")
    # sha256 hex digest of the token; the raw token is only ever shown once, at creation.
    token_hash = models.CharField(max_length=64, unique=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.EDITOR)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"ShareLink({self.project_id}, {self.role})"


class FileType(models.TextChoices):
    TEX = "tex", "TeX"
    BIB = "bib", "BibTeX"
    IMAGE = "image", "Image"
    OTHER = "other", "Other"
    # Not in Plan.md §8's literal type enum (tex|bib|image|other) — folders
    # are a UI/organizational concept the initial schema didn't enumerate.
    # See docs/decisions/project-file-folder-type.md.
    FOLDER = "folder", "Folder"


class ProjectFile(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="files")
    path = models.CharField(max_length=512)
    type = models.CharField(max_length=16, choices=FileType.choices)
    # Opaque, server-generated object storage key; null for folders (which
    # have no content). Never derived from the user-controlled `path`.
    storage_key = models.CharField(max_length=255, null=True, blank=True)
    size = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["project", "path"], name="unique_path_per_project"),
        ]

    def __str__(self):
        return f"{self.project_id}:{self.path}"


class Compiler(models.TextChoices):
    PDFLATEX = "pdflatex", "pdfLaTeX"
    XELATEX = "xelatex", "XeLaTeX"


class BibEngine(models.TextChoices):
    BIBTEX = "bibtex", "BibTeX"
    BIBER = "biber", "Biber"


class ProjectSettings(models.Model):
    """One-to-one with Project. Auto-created on first access with defaults
    (see get_or_create_settings) rather than at Project creation — keeps
    Project creation simple and this stays forward-compatible with fields
    Phase 7's Settings tab UI will add (central .bib, etc.)."""

    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name="settings")
    main_doc_path = models.CharField(max_length=512, default="main.tex")
    central_bib_path = models.CharField(max_length=512, null=True, blank=True)
    compiler = models.CharField(max_length=16, choices=Compiler.choices, default=Compiler.PDFLATEX)
    # latexmk auto-detects bibtex vs biber from the document's own packages
    # (biblatex -> biber, traditional \bibliography{} -> bibtex) — this
    # setting doesn't override that (no such latexmk flag exists, verified
    # against its docs). It tracks which workflow the project uses and
    # ensures the corresponding binary is expected to be available.
    bib_engine = models.CharField(max_length=16, choices=BibEngine.choices, default=BibEngine.BIBTEX)
    cite_autocomplete_enabled = models.BooleanField(default=True)

    def __str__(self):
        return f"Settings({self.project_id}, {self.compiler})"


class CompileRun(models.Model):
    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        TIMEOUT = "timeout", "Timeout"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="compile_runs")
    compiler = models.CharField(max_length=16, choices=Compiler.choices)
    status = models.CharField(max_length=16, choices=Status.choices)
    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    # Null when the compile produced no PDF (failed/timeout).
    pdf_key = models.CharField(max_length=255, null=True, blank=True)
    log_key = models.CharField(max_length=255, null=True, blank=True)
    synctex_key = models.CharField(max_length=255, null=True, blank=True)
    exit_code = models.IntegerField(null=True, blank=True)
    duration_ms = models.IntegerField(null=True, blank=True)
    # Each item: {"message": str, "file": str | None, "line": int | None} — see log_parser.py.
    errors = models.JSONField(default=list, blank=True)
    warnings = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self):
        return f"CompileRun({self.project_id}, {self.status})"
