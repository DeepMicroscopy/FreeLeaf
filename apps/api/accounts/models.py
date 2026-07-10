import uuid

from django.db import models


class User(models.Model):
    class Kind(models.TextChoices):
        ORCID = "orcid", "ORCID"
        EMAIL = "email", "Email"
        ANONYMOUS = "anonymous", "Anonymous"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    orcid_id = models.CharField(max_length=19, unique=True, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    display_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # Only 'email'-kind users need a globally unique address; magic-link
            # login upserts on this. Anonymous/ORCID users may have null/duplicate email.
            models.UniqueConstraint(
                fields=["email"],
                condition=models.Q(kind="email"),
                name="unique_email_for_email_users",
            ),
        ]

    def __str__(self):
        return self.display_name or self.email or self.orcid_id or str(self.id)


class MagicLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField()
    # sha256 hex digest of the token; the raw token is only ever emailed, never stored.
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"MagicLink({self.email})"
