"""SAML 2.0 sign-in (Shibboleth or any standards-compliant IdP) — Plan.md
§9 Phase 9, built on OneLogin's `python3-saml` toolkit (verified directly
against the installed package's source: `OneLogin_Saml2_Auth`'s
constructor, `request_data` dict shape, `login()`/`process_response()`
return values — its own docs were sparse on some of this) and against a
real disposable test IdP end-to-end (docker-compose's `saml-idp` service).

Each `SsoProvider` (kind=saml) gets its own settings dict built fresh per
request — no static `settings.json` file, since this is multi-tenant (many
IdPs, not the one-SP-one-IdP model the toolkit's examples assume).
"""

import os

from django.conf import settings as django_settings
from onelogin.saml2.auth import OneLogin_Saml2_Auth
from onelogin.saml2.settings import OneLogin_Saml2_Settings

SAML_SP_BASE_URL = os.environ.get("SAML_SP_BASE_URL", "http://localhost:8000")


def _sp_urls(slug: str) -> dict:
    base = f"{SAML_SP_BASE_URL}/api/auth/saml/{slug}"
    return {"metadata": f"{base}/metadata", "acs": f"{base}/acs", "sls": f"{base}/sls"}


def build_settings_dict(provider) -> dict:
    urls = _sp_urls(provider.slug)
    return {
        "strict": True,
        "debug": django_settings.DEBUG,
        "sp": {
            "entityId": urls["metadata"],
            "assertionConsumerService": {
                "url": urls["acs"],
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "singleLogoutService": {
                "url": urls["sls"],
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "NameIDFormat": "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
        },
        "idp": {
            "entityId": provider.saml_idp_entity_id,
            "singleSignOnService": {
                "url": provider.saml_idp_sso_url,
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": provider.saml_idp_x509_cert,
        },
    }


def prepare_request_data(request) -> dict:
    """Builds the `request_data` dict python3-saml expects, from a Django
    HttpRequest. Trusts X-Forwarded-* only insofar as Django's own request
    object already does (this reads request.get_host()/is_secure(), which
    respect Django's USE_X_FORWARDED_HOST/SECURE_PROXY_SSL_HEADER settings,
    not raw untrusted headers directly)."""
    return {
        "https": "on" if request.is_secure() else "off",
        "http_host": request.get_host(),
        "script_name": request.path,
        "get_data": request.GET.dict(),
        "post_data": request.POST.dict(),
    }


def build_auth(request, provider) -> OneLogin_Saml2_Auth:
    return OneLogin_Saml2_Auth(prepare_request_data(request), old_settings=build_settings_dict(provider))


def get_sp_metadata_xml(provider) -> bytes:
    saml_settings = OneLogin_Saml2_Settings(settings=build_settings_dict(provider), sp_validation_only=True)
    return saml_settings.get_sp_metadata()
