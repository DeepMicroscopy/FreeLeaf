"""Institutional SSO (Plan.md §9 Phase 9): a public provider list for the
login picker, LDAP/AD sign-in, and SAML sign-in (Shibboleth or any
standards-compliant SAML 2.0 IdP). Admin CRUD for the provider registry
lives in sso_admin_api.py.
"""

import logging

from django.conf import settings as django_settings
from django.http import HttpResponse, HttpResponseRedirect
from ninja import Router, Schema
from ninja.errors import HttpError

from core.session import log_in
from core.urlsafety import safe_next_path

from . import saml_auth
from .api import UserOut, _user_out
from .auth import CsrfProtect
from .ldap_auth import LdapAuthError, authenticate as ldap_authenticate
from .models import SsoProvider, SsoProviderKind, User

logger = logging.getLogger(__name__)

router = Router()
csrf_protect = CsrfProtect()


class SsoProviderPublicOut(Schema):
    slug: str
    name: str
    kind: str


@router.get("/auth/sso/providers", response=list[SsoProviderPublicOut])
def list_public_providers(request):
    providers = SsoProvider.objects.filter(enabled=True).order_by("name")
    return [SsoProviderPublicOut(slug=p.slug, name=p.name, kind=p.kind) for p in providers]


def _get_enabled_provider_or_404(slug: str, kind: str) -> SsoProvider:
    provider = SsoProvider.objects.filter(slug=slug, kind=kind, enabled=True).first()
    if provider is None:
        raise HttpError(404, "No such SSO provider.")
    return provider


class LdapLoginIn(Schema):
    username: str
    password: str


@router.post("/auth/ldap/{slug}/login", response=UserOut, auth=csrf_protect)
def ldap_login(request, slug: str, payload: LdapLoginIn):
    provider = _get_enabled_provider_or_404(slug, SsoProviderKind.LDAP)

    try:
        identity = ldap_authenticate(provider, payload.username, payload.password)
    except LdapAuthError as exc:
        raise HttpError(400, str(exc)) from exc

    user, created = User.objects.get_or_create(
        kind=User.Kind.SSO,
        sso_provider=provider,
        sso_external_id=identity.external_id,
        defaults={"display_name": identity.display_name, "email": identity.email},
    )
    if not created:
        update_fields = []
        if identity.display_name and user.display_name != identity.display_name:
            user.display_name = identity.display_name
            update_fields.append("display_name")
        if identity.email and user.email != identity.email:
            user.email = identity.email
            update_fields.append("email")
        if update_fields:
            user.save(update_fields=update_fields)

    log_in(request, user)
    return _user_out(user)


def _first_attribute(attributes: dict, name: str) -> str | None:
    values = attributes.get(name) or []
    return values[0] if values else None


@router.get("/auth/saml/{slug}/metadata")
def saml_metadata(request, slug: str):
    provider = _get_enabled_provider_or_404(slug, SsoProviderKind.SAML)
    xml = saml_auth.get_sp_metadata_xml(provider)
    return HttpResponse(xml, content_type="text/xml")


@router.get("/auth/saml/{slug}/login")
def saml_login(request, slug: str, next: str | None = None):
    provider = _get_enabled_provider_or_404(slug, SsoProviderKind.SAML)
    auth = saml_auth.build_auth(request, provider)
    redirect_url = auth.login(return_to=safe_next_path(next) or "")
    return HttpResponseRedirect(redirect_url)


@router.post("/auth/saml/{slug}/acs", auth=None)
def saml_acs(request, slug: str):
    # auth=None: this is reached by the *IdP's* browser-based cross-site
    # POST, not our own frontend — there's no session/CSRF token to check
    # yet. Trust instead comes from validating the SAML response's
    # cryptographic signature against the provider's stored IdP cert
    # (auth.process_response() below), the actual security boundary here.
    provider = _get_enabled_provider_or_404(slug, SsoProviderKind.SAML)
    auth = saml_auth.build_auth(request, provider)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        logger.warning("SAML ACS error for provider %s: %s (%s)", slug, errors, auth.get_last_error_reason())
        raise HttpError(400, f"SAML sign-in failed: {auth.get_last_error_reason() or errors}")
    if not auth.is_authenticated():
        raise HttpError(400, "SAML response did not authenticate.")

    name_id = auth.get_nameid()
    if not name_id:
        raise HttpError(400, "SAML response did not include a NameID.")
    attributes = auth.get_attributes()
    email = _first_attribute(attributes, provider.saml_email_attribute)
    display_name = _first_attribute(attributes, provider.saml_display_name_attribute)

    user, created = User.objects.get_or_create(
        kind=User.Kind.SSO,
        sso_provider=provider,
        sso_external_id=name_id,
        defaults={"display_name": display_name, "email": email},
    )
    if not created:
        update_fields = []
        if display_name and user.display_name != display_name:
            user.display_name = display_name
            update_fields.append("display_name")
        if email and user.email != email:
            user.email = email
            update_fields.append("email")
        if update_fields:
            user.save(update_fields=update_fields)

    log_in(request, user)
    relay_state = request.POST.get("RelayState", "")
    next_path = safe_next_path(relay_state) or ""
    return HttpResponseRedirect(f"{django_settings.FRONTEND_URL}{next_path}")
