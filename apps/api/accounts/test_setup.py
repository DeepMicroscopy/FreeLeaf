"""Tests for first-run setup (Plan.md §9 Phase 11): gated purely by "does
any admin user exist yet", not a separate flag — see setup_api.py's
docstring for why the bootstrap magic-link path is kept fully separate from
the regular invite-gated one. Runs against Django's isolated per-test DB
(starts empty), so "zero admins" is just the natural starting state here —
no need to touch (or risk) a real dev/prod database to exercise it.
"""

import json
import re
from urllib.parse import parse_qs, urlparse

from django.core import mail

from core.testing import ApiTestCase

from .models import SiteSettings, User


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def put_json(client, url, data=None):
    return client.put(url, data=json.dumps(data or {}), content_type="application/json")


class SetupStatusTests(ApiTestCase):
    def test_needs_setup_true_when_no_admin_exists(self):
        resp = self.client.get("/api/setup/status")
        self.assertEqual(resp.json()["needs_setup"], True)

    def test_needs_setup_false_once_an_admin_exists(self):
        User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        resp = self.client.get("/api/setup/status")
        self.assertEqual(resp.json()["needs_setup"], False)

    def test_orcid_available_reflects_site_settings_and_credentials(self):
        # No ORCID_CLIENT_ID/SECRET configured in the test environment, so
        # orcid_available should be false even though orcid_enabled
        # defaults to true.
        resp = self.client.get("/api/setup/status")
        body = resp.json()
        self.assertEqual(body["orcid_enabled"], True)
        self.assertEqual(body["orcid_configured"], False)
        self.assertEqual(body["orcid_available"], False)


class SetupOrcidToggleTests(ApiTestCase):
    def test_can_toggle_while_needs_setup(self):
        resp = put_json(self.client, "/api/setup/orcid-enabled", {"orcid_enabled": False})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["orcid_enabled"], False)
        self.assertEqual(SiteSettings.load().orcid_enabled, False)

    def test_rejected_once_setup_is_complete(self):
        User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        resp = put_json(self.client, "/api/setup/orcid-enabled", {"orcid_enabled": False})
        self.assertEqual(resp.status_code, 400)
        # Unchanged.
        self.assertEqual(SiteSettings.load().orcid_enabled, True)


class SetupBootstrapMagicLinkTests(ApiTestCase):
    def _extract_token(self, email_body: str) -> str:
        match = re.search(r"https?://\S+", email_body)
        assert match, f"no link found in email body: {email_body!r}"
        qs = parse_qs(urlparse(match.group(0)).query)
        return qs["token"][0]

    def test_full_bootstrap_flow_creates_and_logs_in_first_admin(self):
        self.assertEqual(User.objects.filter(is_admin=True).count(), 0)

        resp = post_json(self.client, "/api/setup/request-admin-link", {"email": "future-admin@example.com"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/setup/verify", mail.outbox[0].body)

        token = self._extract_token(mail.outbox[0].body)
        resp = post_json(self.client, "/api/setup/verify-admin-link", {"token": token})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["email"], "future-admin@example.com")
        self.assertEqual(body["is_admin"], True)

        user = User.objects.get(email="future-admin@example.com")
        self.assertTrue(user.is_admin)

        # The session this response set is actually logged in.
        me = self.client.get("/api/auth/me")
        self.assertEqual(me.json()["email"], "future-admin@example.com")

    def test_request_rejected_once_setup_is_complete(self):
        User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        resp = post_json(self.client, "/api/setup/request-admin-link", {"email": "someone-else@example.com"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_verify_rejected_once_setup_is_complete_even_with_a_valid_token(self):
        resp = post_json(self.client, "/api/setup/request-admin-link", {"email": "future-admin@example.com"})
        self.assertEqual(resp.status_code, 200)
        token = self._extract_token(mail.outbox[0].body)

        # Someone else completes setup in the meantime (e.g. a second tab).
        User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)

        resp = post_json(self.client, "/api/setup/verify-admin-link", {"token": token})
        self.assertEqual(resp.status_code, 400)
        # Rejected before the token was ever consumed — no second admin,
        # and the would-be user was never even created.
        self.assertEqual(User.objects.filter(is_admin=True).count(), 1)
        self.assertFalse(User.objects.filter(email="future-admin@example.com").exists())

    def test_bootstrap_link_never_verifies_through_the_general_magic_link_endpoint(self):
        # The regular /auth/magic-link/verify endpoint must not honor a
        # setup-bootstrap token as an admin-granting sign-in — it's a
        # perfectly normal magic link otherwise (verify_magic_link is
        # shared), it just never promotes anyone to admin.
        resp = post_json(self.client, "/api/setup/request-admin-link", {"email": "future-admin@example.com"})
        token = self._extract_token(mail.outbox[0].body)

        resp = post_json(self.client, "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["is_admin"])
        self.assertFalse(User.objects.get(email="future-admin@example.com").is_admin)


class OrcidCallbackBootstrapTests(ApiTestCase):
    def test_orcid_login_blocked_when_disabled(self):
        s = SiteSettings.load()
        s.orcid_enabled = False
        s.save(update_fields=["orcid_enabled"])
        resp = self.client.get("/api/auth/orcid/login")
        self.assertEqual(resp.status_code, 403)

    def test_orcid_login_allowed_by_default(self):
        resp = self.client.get("/api/auth/orcid/login", follow=False)
        self.assertEqual(resp.status_code, 302)
