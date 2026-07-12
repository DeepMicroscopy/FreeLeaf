import uuid

from django.db import models

from accounts.models import User


class Role(models.TextChoices):
    OWNER = "owner", "Owner"
    EDITOR = "editor", "Editor"
    # Can edit text, but only as tracked suggestions (never a direct write) —
    # locked to Reviewing mode client-side; see EditingModeProvider/
    # ModeSwitcher in apps/web. Same read access as VIEWER otherwise (no
    # file management, settings, or member/share-link management).
    REVIEWER = "reviewer", "Reviewer"
    VIEWER = "viewer", "Viewer"


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="owned_projects"
    )
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Who last touched the project (renamed it, edited/created/deleted a file,
    # restored a snapshot). Best-effort for live collaborative edits — the
    # collab server attributes a persisted flush to whichever connection's
    # update it saw most recently, not a full authorship history.
    last_edited_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    def __str__(self):
        return self.name


def touch_project(project: "Project", user: User | None = None) -> None:
    """Bumps `updated_at` (via `auto_now`) and, if a user is known, records
    them as `last_edited_by`. Call this from any endpoint that changes a
    project's content, not just `Project` field edits directly."""
    if user is not None:
        project.last_edited_by = user
        project.save(update_fields=["updated_at", "last_edited_by"])
    else:
        project.save(update_fields=["updated_at"])


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


class SnapshotKind(models.TextChoices):
    AUTO = "auto", "Automatic"
    MANUAL = "manual", "Manual"


class ProjectSnapshot(models.Model):
    """A version-history checkpoint (Plan.md §9 Phase 8): a zip of every
    file's content at one point in time, so the Time Travel UI can diff or
    restore an individual file without needing per-file delta storage —
    LaTeX projects are small enough that a full copy per snapshot is cheap,
    and this reuses the same zip format as /export and /import."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="snapshots")
    created_at = models.DateTimeField(auto_now_add=True)
    # Null for automatic snapshots taken with no specific actor in view (e.g.
    # the pre-restore safety snapshot) or if the creating user is deleted.
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=16, choices=SnapshotKind.choices)
    label = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    archive_key = models.CharField(max_length=255)
    # SHA-256 of the archive's content, so an automatic snapshot can cheaply
    # skip itself when nothing has changed since the last one (comparing
    # against this column, not re-fetching + re-hashing the previous zip).
    content_hash = models.CharField(max_length=64, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"ProjectSnapshot({self.project_id}, {self.kind}, {self.created_at})"


class Comment(models.Model):
    """A comment anchored to a line in a file (Plan.md §9 Phase 8). Anchoring
    is deliberately just a line number captured at creation time, not a Yjs
    relative position — simple, and honest that it can drift if lines are
    inserted above it later, rather than pretending to track edits
    precisely. Only one level of replies is supported (a reply's `parent`
    must itself be a top-level comment, enforced in comments_api.py) —
    matches common review-tool UX (a thread + flat replies, not nested
    reply-to-reply chains).

    A comment may optionally also anchor to a specific marked text range
    (`anchor_from`/`anchor_to`, character offsets into the file's content at
    creation time, `anchor_to` exclusive) rather than just the line —
    same "captured at creation time, can drift" honesty as `anchor_line`,
    just at character instead of line granularity. `anchor_text` is the
    exact substring at creation time, kept only for display (quoting what
    was commented on) — never re-verified against live content. Null on all
    three when a comment is a plain whole-line comment (the original,
    still-supported case) or a reply (replies inherit their parent's
    anchor_line but don't carry their own range)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="comments")
    file = models.ForeignKey(ProjectFile, on_delete=models.CASCADE, related_name="comments")
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="replies")
    anchor_line = models.PositiveIntegerField()
    anchor_from = models.PositiveIntegerField(null=True, blank=True)
    anchor_to = models.PositiveIntegerField(null=True, blank=True)
    anchor_text = models.TextField(null=True, blank=True)
    body = models.TextField()
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
    resolved_by = models.ForeignKey(
        User, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"Comment({self.project_id}, {self.file_id}, line {self.anchor_line})"
