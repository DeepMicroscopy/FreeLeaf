import uuid

from django.db import models


class User(models.Model):
    class Kind(models.TextChoices):
        ORCID = "orcid", "ORCID"
        EMAIL = "email", "Email"
        ANONYMOUS = "anonymous", "Anonymous"
        SSO = "sso", "Institutional SSO"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    orcid_id = models.CharField(max_length=19, unique=True, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    display_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)
    # Gates the in-app admin view (Plan.md §9 Phase 7) — distinct from Django
    # admin's own staff/superuser flags on the *separate* django.contrib.auth
    # User model (see CLAUDE.md: that one is reserved for Django admin only).
    # No UI to grant this yet; bootstrap the first admin via manage.py shell.
    is_admin = models.BooleanField(default=False)
    # kind='sso' users only (Plan.md §9 Phase 9) — mirrors how ORCID users
    # are keyed by orcid_id. external_id is the SAML NameID or the LDAP
    # uid/DN, whichever the provider's kind uses.
    sso_provider = models.ForeignKey(
        "SsoProvider", null=True, blank=True, on_delete=models.SET_NULL, related_name="users"
    )
    sso_external_id = models.CharField(max_length=512, null=True, blank=True)

    class Meta:
        constraints = [
            # Only 'email'-kind users need a globally unique address; magic-link
            # login upserts on this. Anonymous/ORCID users may have null/duplicate email.
            models.UniqueConstraint(
                fields=["email"],
                condition=models.Q(kind="email"),
                name="unique_email_for_email_users",
            ),
            models.UniqueConstraint(
                fields=["sso_provider", "sso_external_id"],
                condition=models.Q(kind="sso"),
                name="unique_external_id_per_sso_provider",
            ),
        ]

    def __str__(self):
        return self.display_name or self.email or self.orcid_id or str(self.id)


class SiteSettings(models.Model):
    """Singleton row of instance-wide, admin-configurable settings (Plan.md
    §9 Phase 11) — fetched via `load()`, which lazily creates the single
    row on first access rather than needing a migration data fixture or a
    fixed known primary key the caller has to remember."""

    orcid_enabled = models.BooleanField(default=True)
    # Shown next to the leaf icon in place of the literal "FreeLeaf" text —
    # the icon itself isn't configurable, just the name beside it.
    site_name = models.CharField(max_length=100, default="FreeLeaf")

    class TemplateContributionMode(models.TextChoices):
        ADMIN_ONLY = "admin_only", "Admins only"
        REVIEW_REQUIRED = "review_required", "Anyone, pending admin review"
        OPEN = "open", "Anyone, published immediately"

    template_contribution_mode = models.CharField(
        max_length=20, choices=TemplateContributionMode.choices, default=TemplateContributionMode.ADMIN_ONLY,
    )

    @classmethod
    def load(cls) -> "SiteSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)


class SsoProviderKind(models.TextChoices):
    SAML = "saml", "SAML (Shibboleth)"
    LDAP = "ldap", "LDAP / Active Directory"


class SsoProvider(models.Model):
    """One institution's SSO connection (Plan.md §9 Phase 9) — multi-tenant:
    many of these can be registered at once, each independent. `kind`
    determines which block of fields below is actually used; the other
    block stays blank. Active Directory is just LDAP with AD-flavored bind
    conventions, not a separate `kind` — the admin UI labels it accordingly
    but the underlying integration is identical.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    slug = models.SlugField(max_length=64, unique=True)
    kind = models.CharField(max_length=16, choices=SsoProviderKind.choices)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # SAML fields (blank when kind=ldap).
    saml_idp_entity_id = models.CharField(max_length=512, blank=True)
    saml_idp_sso_url = models.URLField(blank=True)
    saml_idp_x509_cert = models.TextField(blank=True)
    saml_email_attribute = models.CharField(max_length=255, blank=True, default="email")
    saml_display_name_attribute = models.CharField(max_length=255, blank=True, default="displayName")

    # LDAP/AD fields (blank when kind=saml). Search+bind pattern: bind as
    # the service account to search for the user's DN, then bind again as
    # that DN with the user's own password to actually verify it — LDAP/AD
    # directories don't hand out comparable password hashes, so this
    # two-step dance is the standard way to check a password against one.
    ldap_server_uri = models.CharField(max_length=255, blank=True)
    ldap_bind_dn = models.CharField(max_length=255, blank=True)
    # Encrypted at rest (core.secret_encryption) — defense in depth, see
    # that module's docstring for what this does and doesn't protect against.
    ldap_bind_password_encrypted = models.TextField(blank=True)
    ldap_user_search_base = models.CharField(max_length=255, blank=True)
    ldap_user_search_filter = models.CharField(max_length=255, blank=True, default="(uid=%(user)s)")
    ldap_email_attribute = models.CharField(max_length=255, blank=True, default="mail")
    ldap_display_name_attribute = models.CharField(max_length=255, blank=True, default="displayName")
    ldap_use_starttls = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"SsoProvider({self.slug}, {self.kind})"


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
