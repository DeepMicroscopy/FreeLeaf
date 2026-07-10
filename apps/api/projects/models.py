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
