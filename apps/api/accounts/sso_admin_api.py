"""Admin CRUD for the SSO provider registry (Plan.md §9 Phase 9) — extends
the Phase 7 admin area. Secrets (`ldap_bind_password`) are write-only:
accepted on create/update, never returned by any read endpoint.
"""

import re
import uuid

from ninja import Router, Schema
from ninja.errors import HttpError

from core.secret_encryption import encrypt_secret
from core.session import get_current_user

from .admin_api import require_admin
from .auth import SessionAuth
from .models import SsoProvider, SsoProviderKind

router = Router(auth=SessionAuth())

_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class SsoProviderAdminOut(Schema):
    id: uuid.UUID
    name: str
    slug: str
    kind: str
    enabled: bool
    created_at: str
    updated_at: str

    saml_idp_entity_id: str
    saml_idp_sso_url: str
    saml_idp_x509_cert: str
    saml_email_attribute: str
    saml_display_name_attribute: str

    ldap_server_uri: str
    ldap_bind_dn: str
    ldap_has_bind_password: bool
    ldap_user_search_base: str
    ldap_user_search_filter: str
    ldap_email_attribute: str
    ldap_display_name_attribute: str
    ldap_use_starttls: bool


def _out(p: SsoProvider) -> SsoProviderAdminOut:
    return SsoProviderAdminOut(
        id=p.id, name=p.name, slug=p.slug, kind=p.kind, enabled=p.enabled,
        created_at=p.created_at.isoformat(), updated_at=p.updated_at.isoformat(),
        saml_idp_entity_id=p.saml_idp_entity_id, saml_idp_sso_url=p.saml_idp_sso_url,
        saml_idp_x509_cert=p.saml_idp_x509_cert, saml_email_attribute=p.saml_email_attribute,
        saml_display_name_attribute=p.saml_display_name_attribute,
        ldap_server_uri=p.ldap_server_uri, ldap_bind_dn=p.ldap_bind_dn,
        ldap_has_bind_password=bool(p.ldap_bind_password_encrypted),
        ldap_user_search_base=p.ldap_user_search_base, ldap_user_search_filter=p.ldap_user_search_filter,
        ldap_email_attribute=p.ldap_email_attribute, ldap_display_name_attribute=p.ldap_display_name_attribute,
        ldap_use_starttls=p.ldap_use_starttls,
    )


@router.get("/admin/sso-providers", response=list[SsoProviderAdminOut])
def list_providers(request):
    require_admin(get_current_user(request))
    return [_out(p) for p in SsoProvider.objects.all()]


class SsoProviderCreateIn(Schema):
    name: str
    slug: str
    kind: str
    enabled: bool = True

    saml_idp_entity_id: str = ""
    saml_idp_sso_url: str = ""
    saml_idp_x509_cert: str = ""
    saml_email_attribute: str = "email"
    saml_display_name_attribute: str = "displayName"

    ldap_server_uri: str = ""
    ldap_bind_dn: str = ""
    ldap_bind_password: str = ""
    ldap_user_search_base: str = ""
    ldap_user_search_filter: str = "(uid=%(user)s)"
    ldap_email_attribute: str = "mail"
    ldap_display_name_attribute: str = "displayName"
    ldap_use_starttls: bool = False


def _validate_slug(slug: str) -> None:
    if not _SLUG_RE.match(slug):
        raise HttpError(400, "Slug must be lowercase letters, digits, and hyphens only.")


@router.post("/admin/sso-providers", response=SsoProviderAdminOut)
def create_provider(request, payload: SsoProviderCreateIn):
    require_admin(get_current_user(request))

    if payload.kind not in (SsoProviderKind.SAML, SsoProviderKind.LDAP):
        raise HttpError(400, "kind must be 'saml' or 'ldap'.")
    _validate_slug(payload.slug)
    if SsoProvider.objects.filter(slug=payload.slug).exists():
        raise HttpError(409, "A provider with that slug already exists.")

    provider = SsoProvider.objects.create(
        name=payload.name.strip(),
        slug=payload.slug,
        kind=payload.kind,
        enabled=payload.enabled,
        saml_idp_entity_id=payload.saml_idp_entity_id,
        saml_idp_sso_url=payload.saml_idp_sso_url,
        saml_idp_x509_cert=payload.saml_idp_x509_cert,
        saml_email_attribute=payload.saml_email_attribute,
        saml_display_name_attribute=payload.saml_display_name_attribute,
        ldap_server_uri=payload.ldap_server_uri,
        ldap_bind_dn=payload.ldap_bind_dn,
        ldap_bind_password_encrypted=encrypt_secret(payload.ldap_bind_password),
        ldap_user_search_base=payload.ldap_user_search_base,
        ldap_user_search_filter=payload.ldap_user_search_filter,
        ldap_email_attribute=payload.ldap_email_attribute,
        ldap_display_name_attribute=payload.ldap_display_name_attribute,
        ldap_use_starttls=payload.ldap_use_starttls,
    )
    return _out(provider)


class SsoProviderUpdateIn(Schema):
    name: str | None = None
    enabled: bool | None = None

    saml_idp_entity_id: str | None = None
    saml_idp_sso_url: str | None = None
    saml_idp_x509_cert: str | None = None
    saml_email_attribute: str | None = None
    saml_display_name_attribute: str | None = None

    ldap_server_uri: str | None = None
    ldap_bind_dn: str | None = None
    ldap_bind_password: str | None = None  # omitted = keep existing; "" clears it
    ldap_user_search_base: str | None = None
    ldap_user_search_filter: str | None = None
    ldap_email_attribute: str | None = None
    ldap_display_name_attribute: str | None = None
    ldap_use_starttls: bool | None = None


def _get_provider_or_404(provider_id: uuid.UUID) -> SsoProvider:
    provider = SsoProvider.objects.filter(id=provider_id).first()
    if provider is None:
        raise HttpError(404, "Provider not found.")
    return provider


@router.patch("/admin/sso-providers/{provider_id}", response=SsoProviderAdminOut)
def update_provider(request, provider_id: uuid.UUID, payload: SsoProviderUpdateIn):
    require_admin(get_current_user(request))
    provider = _get_provider_or_404(provider_id)

    data = payload.dict(exclude_unset=True, exclude={"ldap_bind_password"})
    for field, value in data.items():
        setattr(provider, field, value.strip() if isinstance(value, str) else value)
    if payload.ldap_bind_password is not None:
        provider.ldap_bind_password_encrypted = encrypt_secret(payload.ldap_bind_password)

    provider.save()
    return _out(provider)


@router.delete("/admin/sso-providers/{provider_id}")
def delete_provider(request, provider_id: uuid.UUID):
    require_admin(get_current_user(request))
    provider = _get_provider_or_404(provider_id)
    provider.delete()
    return {"ok": True}
