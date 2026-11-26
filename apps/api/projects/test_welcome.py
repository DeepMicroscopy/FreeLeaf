"""Invite attribution (ShareLink.created_by -> Membership.invited_by) and
the one-time ProjectWelcome.tsx gate (Membership.welcomed_at) it drives."""

import json

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Membership


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


class WelcomeTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        self.owner_user = _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Paper"})
        self.project_id = create.json()["id"]

    def _invite(self, role="editor"):
        return post_json(
            self.owner, f"/api/projects/{self.project_id}/share-links", {"role": role}
        ).json()["token"]

    def test_owner_needs_no_welcome(self):
        data = self.owner.get(f"/api/projects/{self.project_id}").json()
        self.assertFalse(data["needs_welcome"])
        self.assertIsNone(data["invited_by_name"])

    def test_joining_member_sees_who_invited_them_and_needs_welcome(self):
        token = self._invite(role="editor")
        joiner = Client()
        _login_new_user(joiner, "joiner@example.com")
        join = post_json(joiner, f"/api/share-links/{token}/join", {})
        self.assertEqual(join.status_code, 200)
        self.assertTrue(join.json()["needs_welcome"])
        self.assertEqual(join.json()["invited_by_name"], "owner@example.com")

        # Still true on a fresh GET, not just the join response itself.
        data = joiner.get(f"/api/projects/{self.project_id}").json()
        self.assertTrue(data["needs_welcome"])
        self.assertEqual(data["invited_by_name"], "owner@example.com")

    def test_marking_welcome_seen_clears_the_flag_for_good(self):
        token = self._invite(role="viewer")
        joiner = Client()
        _login_new_user(joiner, "viewer@example.com")
        post_json(joiner, f"/api/share-links/{token}/join", {})

        seen = post_json(joiner, f"/api/projects/{self.project_id}/welcome-seen")
        self.assertEqual(seen.status_code, 200)
        self.assertFalse(seen.json()["needs_welcome"])

        data = joiner.get(f"/api/projects/{self.project_id}").json()
        self.assertFalse(data["needs_welcome"])

        membership = Membership.objects.get(project_id=self.project_id, user__email="viewer@example.com")
        self.assertIsNotNone(membership.welcomed_at)

    def test_rejoining_an_existing_membership_does_not_reset_welcome(self):
        token = self._invite(role="editor")
        joiner = Client()
        _login_new_user(joiner, "joiner2@example.com")
        post_json(joiner, f"/api/share-links/{token}/join", {})
        post_json(joiner, f"/api/projects/{self.project_id}/welcome-seen")

        # Same member follows the invite link again (already has a
        # membership) — get_or_create's defaults are ignored, so the
        # already-dismissed welcome stays dismissed.
        rejoin = post_json(joiner, f"/api/share-links/{token}/join", {})
        self.assertFalse(rejoin.json()["needs_welcome"])


class SharePreviewTests(WelcomeTests):
    """The public, pre-authentication preview JoinPage.tsx shows on
    /join/:token — before picking how to identify yourself, not just after."""

    def test_anonymous_visitor_can_preview_without_joining(self):
        token = self._invite(role="viewer")
        response = Client().get(f"/api/share-links/{token}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["project_name"], "Paper")
        self.assertEqual(data["role"], "viewer")
        self.assertEqual(data["invited_by_name"], "owner@example.com")
        self.assertFalse(data["has_thumbnail"])
        # A preview never creates a membership.
        self.assertEqual(Membership.objects.filter(project_id=self.project_id).count(), 1)

    def test_invalid_token_404s(self):
        response = Client().get("/api/share-links/not-a-real-token")
        self.assertEqual(response.status_code, 404)

    def test_thumbnail_404s_when_project_has_none(self):
        token = self._invite(role="viewer")
        response = Client().get(f"/api/share-links/{token}/thumbnail")
        self.assertEqual(response.status_code, 404)
