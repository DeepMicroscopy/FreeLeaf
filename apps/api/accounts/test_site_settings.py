"""Tests for admin site settings (Plan.md §9 Phase 11): ORCID enable/disable
(existing) plus the configurable site name (new) and the public site-info
endpoint the login/setup pages read it from before anyone's signed in.
"""

import json

from django.test import Client

from core.testing import ApiTestCase, login_as

from .models import SiteSettings, User


def put_json(client, url, data=None):
    return client.put(url, data=json.dumps(data or {}), content_type="application/json")


class SiteSettingsTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        login_as(self.admin, User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True))

        self.regular = Client()
        login_as(self.regular, User.objects.create(kind=User.Kind.EMAIL, email="regular@example.com"))

    def test_defaults_to_freeleaf(self):
        response = self.admin.get("/api/admin/site-settings")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["site_name"], "FreeLeaf")

    def test_non_admin_gets_403(self):
        response = self.regular.get("/api/admin/site-settings")
        self.assertEqual(response.status_code, 403)
        response = put_json(self.regular, "/api/admin/site-settings", {"orcid_enabled": True, "site_name": "Nope"})
        self.assertEqual(response.status_code, 403)

    def test_admin_can_rename_the_site(self):
        response = put_json(self.admin, "/api/admin/site-settings", {"orcid_enabled": True, "site_name": "Acme Labs"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["site_name"], "Acme Labs")
        self.assertEqual(SiteSettings.load().site_name, "Acme Labs")

    def test_blank_site_name_rejected(self):
        response = put_json(self.admin, "/api/admin/site-settings", {"orcid_enabled": True, "site_name": "   "})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(SiteSettings.load().site_name, "FreeLeaf")

    def test_site_name_is_trimmed(self):
        response = put_json(self.admin, "/api/admin/site-settings", {"orcid_enabled": True, "site_name": "  Acme  "})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["site_name"], "Acme")

    def test_defaults_to_admin_only_template_contribution(self):
        response = self.admin.get("/api/admin/site-settings")
        self.assertEqual(response.json()["template_contribution_mode"], "admin_only")

    def test_admin_can_change_template_contribution_mode(self):
        response = put_json(
            self.admin, "/api/admin/site-settings",
            {"orcid_enabled": True, "site_name": "FreeLeaf", "template_contribution_mode": "open"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["template_contribution_mode"], "open")
        self.assertEqual(SiteSettings.load().template_contribution_mode, "open")

    def test_invalid_template_contribution_mode_rejected(self):
        response = put_json(
            self.admin, "/api/admin/site-settings",
            {"orcid_enabled": True, "site_name": "FreeLeaf", "template_contribution_mode": "bogus"},
        )
        self.assertEqual(response.status_code, 400)

    def test_template_contribution_mode_omitted_leaves_it_unchanged(self):
        put_json(
            self.admin, "/api/admin/site-settings",
            {"orcid_enabled": True, "site_name": "FreeLeaf", "template_contribution_mode": "open"},
        )
        response = put_json(self.admin, "/api/admin/site-settings", {"orcid_enabled": True, "site_name": "Renamed"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["template_contribution_mode"], "open")


class PublicSiteInfoTests(ApiTestCase):
    def test_reflects_the_configured_name_without_auth(self):
        response = Client().get("/api/site-info")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["site_name"], "FreeLeaf")

        s = SiteSettings.load()
        s.site_name = "Acme Labs"
        s.save(update_fields=["site_name"])

        response = Client().get("/api/site-info")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["site_name"], "Acme Labs")
