"""Tests for institutional SSO (Plan.md §9 Phase 9): the provider registry,
LDAP/AD sign-in, SAML sign-in, and admin CRUD. Mocks ldap_auth.authenticate
and saml_auth.build_auth (the calls to external directories/IdPs) so these
run fast without needing the disposable openldap/saml-idp dev containers —
those are exercised for real in live verification, not here. Same
mocking-the-external-call discipline as test_compile.py's dispatch_compile.
"""

import json
from unittest.mock import MagicMock, patch

from django.test import Client

from core.secret_encryption import decrypt_secret, encrypt_secret
from core.testing import ApiTestCase, login_as

from .ldap_auth import LdapAuthError, LdapIdentity
from .models import SsoProvider, SsoProviderKind, User


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


class SecretEncryptionTests(ApiTestCase):
    def test_round_trips(self):
        self.assertEqual(decrypt_secret(encrypt_secret("hunter2")), "hunter2")

    def test_empty_string_round_trips_to_empty(self):
        self.assertEqual(encrypt_secret(""), "")
        self.assertEqual(decrypt_secret(""), "")

    def test_ciphertext_does_not_contain_plaintext(self):
        self.assertNotIn("hunter2", encrypt_secret("hunter2"))


class SsoProviderRegistryTestsBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.ldap_provider = SsoProvider.objects.create(
            name="Test Uni (LDAP)", slug="test-ldap", kind=SsoProviderKind.LDAP, enabled=True,
            ldap_server_uri="ldap://ldap.example.edu:389", ldap_bind_dn="cn=admin,dc=example,dc=edu",
            ldap_bind_password_encrypted=encrypt_secret("adminpw"),
            ldap_user_search_base="dc=example,dc=edu",
        )
        self.saml_provider = SsoProvider.objects.create(
            name="Test Uni (SAML)", slug="test-saml", kind=SsoProviderKind.SAML, enabled=True,
            saml_idp_entity_id="https://idp.example.edu/metadata",
            saml_idp_sso_url="https://idp.example.edu/sso",
            saml_idp_x509_cert="fakecert",
        )
        self.disabled_provider = SsoProvider.objects.create(
            name="Disabled Uni", slug="disabled-uni", kind=SsoProviderKind.LDAP, enabled=False,
        )


class PublicProviderListTests(SsoProviderRegistryTestsBase):
    def test_lists_only_enabled_providers(self):
        response = Client().get("/api/auth/sso/providers")
        self.assertEqual(response.status_code, 200)
        slugs = {p["slug"] for p in response.json()}
        self.assertEqual(slugs, {"test-ldap", "test-saml"})

    def test_no_secrets_in_public_list(self):
        response = Client().get("/api/auth/sso/providers")
        body = json.dumps(response.json())
        self.assertNotIn("adminpw", body)
        self.assertNotIn("bind", body)


class LdapLoginTests(SsoProviderRegistryTestsBase):
    def test_successful_login_creates_user_and_session(self):
        with patch("accounts.sso_api.ldap_authenticate") as mock_auth:
            mock_auth.return_value = LdapIdentity(
                external_id="uid=jdoe,dc=example,dc=edu", email="jdoe@example.edu", display_name="Jane Doe",
            )
            response = post_json(Client(), "/api/auth/ldap/test-ldap/login", {"username": "jdoe", "password": "pw"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kind"], "sso")
        self.assertEqual(body["email"], "jdoe@example.edu")
        self.assertEqual(body["display_name"], "Jane Doe")

        user = User.objects.get(sso_external_id="uid=jdoe,dc=example,dc=edu")
        self.assertEqual(user.sso_provider_id, self.ldap_provider.id)

    def test_repeat_login_reuses_same_user(self):
        with patch("accounts.sso_api.ldap_authenticate") as mock_auth:
            mock_auth.return_value = LdapIdentity(external_id="uid=jdoe,dc=example,dc=edu", email="jdoe@example.edu", display_name="Jane Doe")
            first = post_json(Client(), "/api/auth/ldap/test-ldap/login", {"username": "jdoe", "password": "pw"})
            second = post_json(Client(), "/api/auth/ldap/test-ldap/login", {"username": "jdoe", "password": "pw"})
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(User.objects.filter(sso_external_id="uid=jdoe,dc=example,dc=edu").count(), 1)

    def test_invalid_credentials_return_400(self):
        with patch("accounts.sso_api.ldap_authenticate") as mock_auth:
            mock_auth.side_effect = LdapAuthError("Invalid username or password.")
            response = post_json(Client(), "/api/auth/ldap/test-ldap/login", {"username": "jdoe", "password": "wrong"})
        self.assertEqual(response.status_code, 400)

    def test_disabled_provider_is_404(self):
        response = post_json(Client(), "/api/auth/ldap/disabled-uni/login", {"username": "jdoe", "password": "pw"})
        self.assertEqual(response.status_code, 404)

    def test_unknown_provider_is_404(self):
        response = post_json(Client(), "/api/auth/ldap/nope/login", {"username": "jdoe", "password": "pw"})
        self.assertEqual(response.status_code, 404)

    def test_saml_slug_rejected_on_ldap_endpoint(self):
        response = post_json(Client(), "/api/auth/ldap/test-saml/login", {"username": "jdoe", "password": "pw"})
        self.assertEqual(response.status_code, 404)


def _fake_saml_auth(authenticated=True, errors=None, name_id="user123", attributes=None):
    mock_auth = MagicMock()
    mock_auth.process_response.return_value = None
    mock_auth.get_errors.return_value = errors or []
    mock_auth.get_last_error_reason.return_value = "fake reason" if errors else None
    mock_auth.is_authenticated.return_value = authenticated
    mock_auth.get_nameid.return_value = name_id
    mock_auth.get_attributes.return_value = attributes or {"email": ["jdoe@example.edu"], "displayName": ["Jane Doe"]}
    return mock_auth


class SamlAcsTests(SsoProviderRegistryTestsBase):
    def test_successful_assertion_creates_user_and_session(self):
        with patch("accounts.sso_api.saml_auth.build_auth", return_value=_fake_saml_auth()):
            response = Client().post("/api/auth/saml/test-saml/acs", data={}, follow=False)
        self.assertEqual(response.status_code, 302)
        user = User.objects.get(sso_external_id="user123")
        self.assertEqual(user.email, "jdoe@example.edu")
        self.assertEqual(user.display_name, "Jane Doe")
        self.assertEqual(user.sso_provider_id, self.saml_provider.id)

    def test_saml_errors_return_400(self):
        with patch("accounts.sso_api.saml_auth.build_auth", return_value=_fake_saml_auth(errors=["invalid_response"])):
            response = Client().post("/api/auth/saml/test-saml/acs", data={})
        self.assertEqual(response.status_code, 400)

    def test_not_authenticated_returns_400(self):
        with patch("accounts.sso_api.saml_auth.build_auth", return_value=_fake_saml_auth(authenticated=False)):
            response = Client().post("/api/auth/saml/test-saml/acs", data={})
        self.assertEqual(response.status_code, 400)

    def test_missing_nameid_returns_400(self):
        with patch("accounts.sso_api.saml_auth.build_auth", return_value=_fake_saml_auth(name_id=None)):
            response = Client().post("/api/auth/saml/test-saml/acs", data={})
        self.assertEqual(response.status_code, 400)

    def test_ldap_slug_rejected_on_saml_endpoint(self):
        response = Client().post("/api/auth/saml/test-ldap/acs", data={})
        self.assertEqual(response.status_code, 404)

    def test_metadata_endpoint_returns_xml(self):
        response = Client().get("/api/auth/saml/test-saml/metadata")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"EntityDescriptor", response.content)


class SsoAdminApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        login_as(self.admin, User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True))
        self.regular = Client()
        login_as(self.regular, User.objects.create(kind=User.Kind.EMAIL, email="regular@example.com"))

    def test_non_admin_cannot_list(self):
        response = self.regular.get("/api/admin/sso-providers")
        self.assertEqual(response.status_code, 403)

    def test_requires_login(self):
        response = Client().get("/api/admin/sso-providers")
        self.assertEqual(response.status_code, 401)

    def test_admin_can_create_ldap_provider(self):
        response = post_json(
            self.admin, "/api/admin/sso-providers",
            {
                "name": "New Uni", "slug": "new-uni", "kind": "ldap",
                "ldap_server_uri": "ldap://ldap.new.edu", "ldap_bind_dn": "cn=admin,dc=new,dc=edu",
                "ldap_bind_password": "secret123", "ldap_user_search_base": "dc=new,dc=edu",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ldap_has_bind_password"])
        self.assertNotIn("ldap_bind_password", body)
        self.assertNotIn("secret123", json.dumps(body))

        provider = SsoProvider.objects.get(slug="new-uni")
        self.assertEqual(decrypt_secret(provider.ldap_bind_password_encrypted), "secret123")

    def test_duplicate_slug_rejected(self):
        post_json(self.admin, "/api/admin/sso-providers", {"name": "A", "slug": "dup", "kind": "saml"})
        response = post_json(self.admin, "/api/admin/sso-providers", {"name": "B", "slug": "dup", "kind": "saml"})
        self.assertEqual(response.status_code, 409)

    def test_invalid_slug_rejected(self):
        response = post_json(self.admin, "/api/admin/sso-providers", {"name": "A", "slug": "Not Valid!", "kind": "saml"})
        self.assertEqual(response.status_code, 400)

    def test_invalid_kind_rejected(self):
        response = post_json(self.admin, "/api/admin/sso-providers", {"name": "A", "slug": "a-b", "kind": "oidc"})
        self.assertEqual(response.status_code, 400)

    def test_update_without_password_keeps_existing(self):
        create = post_json(
            self.admin, "/api/admin/sso-providers",
            {
                "name": "Uni", "slug": "keep-pw", "kind": "ldap",
                "ldap_bind_password": "original", "ldap_server_uri": "ldap://x", "ldap_bind_dn": "cn=a",
                "ldap_user_search_base": "dc=x",
            },
        )
        provider_id = create.json()["id"]
        patch_json(self.admin, f"/api/admin/sso-providers/{provider_id}", {"name": "Uni Renamed"})
        provider = SsoProvider.objects.get(id=provider_id)
        self.assertEqual(decrypt_secret(provider.ldap_bind_password_encrypted), "original")
        self.assertEqual(provider.name, "Uni Renamed")

    def test_update_can_change_password(self):
        create = post_json(
            self.admin, "/api/admin/sso-providers",
            {
                "name": "Uni", "slug": "change-pw", "kind": "ldap",
                "ldap_bind_password": "original", "ldap_server_uri": "ldap://x", "ldap_bind_dn": "cn=a",
                "ldap_user_search_base": "dc=x",
            },
        )
        provider_id = create.json()["id"]
        patch_json(self.admin, f"/api/admin/sso-providers/{provider_id}", {"ldap_bind_password": "newpw"})
        provider = SsoProvider.objects.get(id=provider_id)
        self.assertEqual(decrypt_secret(provider.ldap_bind_password_encrypted), "newpw")

    def test_delete_provider(self):
        create = post_json(self.admin, "/api/admin/sso-providers", {"name": "Gone Uni", "slug": "gone-uni", "kind": "saml"})
        provider_id = create.json()["id"]
        response = self.admin.delete(f"/api/admin/sso-providers/{provider_id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(SsoProvider.objects.filter(id=provider_id).exists())

    def test_deleting_provider_keeps_linked_users(self):
        provider = SsoProvider.objects.create(name="X", slug="x-uni", kind=SsoProviderKind.LDAP)
        user = User.objects.create(kind=User.Kind.SSO, sso_provider=provider, sso_external_id="uid=a")
        self.admin.delete(f"/api/admin/sso-providers/{provider.id}")
        user.refresh_from_db()
        self.assertIsNone(user.sso_provider_id)
        self.assertTrue(User.objects.filter(id=user.id).exists())
