import json
from datetime import timedelta
from unittest.mock import patch

from django.core import mail
from django.test import Client
from django.utils import timezone

from core.testing import ApiTestCase, login_as

from .magic_link import TOKEN_TTL_MINUTES
from .models import MagicLink, User
from .orcid import OrcidError, OrcidIdentity


def post_json(client, url, data):
    return client.post(url, data=json.dumps(data), content_type="application/json")


class AnonymousLoginTests(ApiTestCase):
    def test_anonymous_login_creates_user_and_session(self):
        response = post_json(self.client, "/api/auth/anonymous", {"display_name": "Guest 1"})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kind"], "anonymous")
        self.assertEqual(body["display_name"], "Guest 1")

        user = User.objects.get(id=body["id"])
        self.assertEqual(user.kind, User.Kind.ANONYMOUS)

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.json()["id"], body["id"])

    def test_anonymous_login_skip_display_name(self):
        response = post_json(self.client, "/api/auth/anonymous", {})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["display_name"])

    def test_me_is_null_when_not_logged_in(self):
        response = self.client.get("/api/auth/me")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json())

    def test_logout_clears_session(self):
        post_json(self.client, "/api/auth/anonymous", {})
        self.client.post("/api/auth/logout")
        me = self.client.get("/api/auth/me")
        self.assertIsNone(me.json())


class MagicLinkTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        # Magic-link sign-in only works in the accept-an-invite context (see
        # accounts/api.py's magic_link_request), so every test here needs a
        # real ShareLink to request against — set up an inviter + project +
        # link once, independent of self.client (which plays the anonymous
        # requester actually signing in via email, and shouldn't start
        # logged in as the inviter).
        owner = User.objects.create(kind=User.Kind.EMAIL, email="owner@example.com")
        owner_client = Client()
        login_as(owner_client, owner)
        project = post_json(owner_client, "/api/projects", {"name": "Paper"}).json()
        link = post_json(
            owner_client, f"/api/projects/{project['id']}/share-links", {"role": "editor"}
        ).json()
        self.share_link_token = link["token"]

    def _request_link(self, email="researcher@example.com", share_link_token=None):
        response = post_json(
            self.client,
            "/api/auth/magic-link/request",
            {"email": email, "share_link_token": share_link_token or self.share_link_token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        token = body.split("token=")[1].split()[0].strip()
        return token

    def test_request_without_share_link_token_is_rejected(self):
        response = post_json(self.client, "/api/auth/magic-link/request", {"email": "x@example.com"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(len(mail.outbox), 0)

    def test_request_with_invalid_share_link_token_is_rejected(self):
        response = post_json(
            self.client,
            "/api/auth/magic-link/request",
            {"email": "x@example.com", "share_link_token": "not-a-real-token"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_request_with_expired_share_link_token_is_rejected(self):
        from projects.models import ShareLink

        ShareLink.objects.all().update(expires_at=timezone.now() - timedelta(hours=1))
        response = post_json(
            self.client,
            "/api/auth/magic-link/request",
            {"email": "x@example.com", "share_link_token": self.share_link_token},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_request_and_verify_logs_in_and_upserts_user(self):
        token = self._request_link("a@example.com")
        response = post_json(self.client, "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kind"], "email")
        self.assertEqual(body["email"], "a@example.com")

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.json()["email"], "a@example.com")

        # Verifying again with the same email upserts (doesn't duplicate) the user.
        self.assertEqual(User.objects.filter(kind="email", email="a@example.com").count(), 1)

    def test_email_is_normalized_to_lowercase(self):
        token = self._request_link("Mixed.Case@Example.com")
        response = post_json(self.client, "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(response.json()["email"], "mixed.case@example.com")
        self.assertEqual(User.objects.filter(kind="email", email="mixed.case@example.com").count(), 1)

    def test_link_is_single_use(self):
        token = self._request_link("b@example.com")
        first = post_json(self.client, "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(first.status_code, 200)

        second = post_json(Client(), "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(second.status_code, 400)

    def test_expired_link_is_rejected(self):
        token = self._request_link("c@example.com")
        MagicLink.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        response = post_json(self.client, "/api/auth/magic-link/verify", {"token": token})
        self.assertEqual(response.status_code, 400)

    def test_unknown_token_is_rejected(self):
        response = post_json(self.client, "/api/auth/magic-link/verify", {"token": "not-a-real-token"})
        self.assertEqual(response.status_code, 400)

    def test_link_expiry_matches_configured_ttl(self):
        self._request_link("d@example.com")
        link = MagicLink.objects.get(email="d@example.com")
        delta = link.expires_at - link.created_at
        self.assertAlmostEqual(delta.total_seconds(), TOKEN_TTL_MINUTES * 60, delta=5)

    def test_repeated_requests_for_same_email_are_rate_limited(self):
        body = {"email": "rl@example.com", "share_link_token": self.share_link_token}
        for _ in range(3):
            response = post_json(self.client, "/api/auth/magic-link/request", body)
            self.assertEqual(response.status_code, 200)
        response = post_json(self.client, "/api/auth/magic-link/request", body)
        self.assertEqual(response.status_code, 429)


class OrcidLoginTests(ApiTestCase):
    def test_login_redirects_to_orcid_authorize_and_sets_state(self):
        response = self.client.get("/api/auth/orcid/login")
        self.assertEqual(response.status_code, 302)
        self.assertIn("/oauth/authorize", response.url)
        self.assertIn("client_id=", response.url)
        self.assertIn("scope=openid", response.url)
        self.assertIn("orcid_oauth_state", self.client.session)

    def test_callback_without_matching_state_is_rejected(self):
        response = self.client.get("/api/auth/orcid/callback", {"code": "abc", "state": "does-not-match"})
        self.assertEqual(response.status_code, 400)

    @patch("accounts.api.orcid.exchange_code")
    def test_callback_creates_orcid_user_and_logs_in(self, mock_exchange):
        mock_exchange.return_value = OrcidIdentity(orcid_id="0000-0001-2345-6789", name="Ada Lovelace")

        self.client.get("/api/auth/orcid/login")
        state = self.client.session["orcid_oauth_state"]

        response = self.client.get("/api/auth/orcid/callback", {"code": "good-code", "state": state})
        self.assertEqual(response.status_code, 302)

        user = User.objects.get(kind=User.Kind.ORCID, orcid_id="0000-0001-2345-6789")
        self.assertEqual(user.display_name, "Ada Lovelace")

        me = self.client.get("/api/auth/me")
        self.assertEqual(me.json()["orcid_id"], "0000-0001-2345-6789")

    @patch("accounts.api.orcid.exchange_code")
    def test_callback_upserts_existing_orcid_user(self, mock_exchange):
        mock_exchange.return_value = OrcidIdentity(orcid_id="0000-0001-2345-6789", name="Ada Lovelace")
        self.client.get("/api/auth/orcid/login")
        state = self.client.session["orcid_oauth_state"]
        self.client.get("/api/auth/orcid/callback", {"code": "c1", "state": state})

        self.client.get("/api/auth/orcid/login")
        state2 = self.client.session["orcid_oauth_state"]
        self.client.get("/api/auth/orcid/callback", {"code": "c2", "state": state2})

        self.assertEqual(User.objects.filter(orcid_id="0000-0001-2345-6789").count(), 1)

    @patch("accounts.api.orcid.exchange_code")
    def test_callback_surfaces_orcid_errors(self, mock_exchange):
        mock_exchange.side_effect = OrcidError("boom")
        self.client.get("/api/auth/orcid/login")
        state = self.client.session["orcid_oauth_state"]
        response = self.client.get("/api/auth/orcid/callback", {"code": "bad", "state": state})
        self.assertEqual(response.status_code, 400)


class CsrfEnforcementTests(ApiTestCase):
    def test_post_without_csrf_token_is_rejected_when_enforced(self):
        client = Client(enforce_csrf_checks=True)
        response = post_json(client, "/api/auth/anonymous", {})
        self.assertEqual(response.status_code, 403)

    def test_post_with_valid_csrf_cookie_and_header_succeeds(self):
        client = Client(enforce_csrf_checks=True)
        client.get("/api/auth/csrf")
        csrftoken = client.cookies["csrftoken"].value
        response = client.post(
            "/api/auth/anonymous",
            data=json.dumps({}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        self.assertEqual(response.status_code, 200)
