import io
import json
import zipfile
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from accounts.models import SiteSettings, User
from core import storage
from core.testing import ApiTestCase, login_as

from .models import Template


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email, is_admin=False):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email, is_admin=is_admin)
    login_as(client, user)
    return user


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


class FromTemplateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        zip_bytes = _make_zip({"main.tex": b"\\documentclass{article}", "refs.bib": b"@x"})
        self.template = Template.objects.create(
            name="IEEE Conference", source_url="https://example.com/ieee",
            zip_storage_key="templates/test/zip", is_published=True,
        )
        storage.put_object(self.template.zip_storage_key, zip_bytes, "application/zip")

    def test_creates_project_with_templates_files(self):
        response = post_json(
            self.owner, f"/api/projects/from-template/{self.template.id}", {"name": "My Paper"},
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["name"], "My Paper")
        self.assertEqual(body["role"], "owner")

        files = {f["path"] for f in self.owner.get(f"/api/projects/{body['id']}/files").json()}
        self.assertEqual(files, {"main.tex", "refs.bib"})

    def test_unpublished_template_404s_for_non_admin(self):
        self.template.is_published = False
        self.template.save(update_fields=["is_published"])
        response = post_json(self.owner, f"/api/projects/from-template/{self.template.id}", {"name": "X"})
        self.assertEqual(response.status_code, 404)

    def test_blank_name_rejected(self):
        response = post_json(self.owner, f"/api/projects/from-template/{self.template.id}", {"name": "  "})
        self.assertEqual(response.status_code, 400)

    def test_anonymous_cannot_use_template(self):
        anon = Client()
        post_json(anon, "/api/auth/anonymous", {})
        response = post_json(anon, f"/api/projects/from-template/{self.template.id}", {"name": "X"})
        self.assertEqual(response.status_code, 403)

    def test_nonexistent_template_404s(self):
        response = post_json(
            self.owner, "/api/projects/from-template/00000000-0000-0000-0000-000000000000", {"name": "X"},
        )
        self.assertEqual(response.status_code, 404)


class FromGithubTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")

    def test_invalid_owner_rejected_before_any_fetch(self):
        with patch("projects.templates_api.urllib.request.urlopen") as mock_urlopen:
            response = post_json(
                self.owner, "/api/projects/from-github",
                {"name": "X", "owner": "../../etc", "repo": "passwd"},
            )
        self.assertEqual(response.status_code, 400)
        mock_urlopen.assert_not_called()

    def test_invalid_repo_rejected_before_any_fetch(self):
        with patch("projects.templates_api.urllib.request.urlopen") as mock_urlopen:
            response = post_json(
                self.owner, "/api/projects/from-github",
                {"name": "X", "owner": "someuser", "repo": "a/b"},
            )
        self.assertEqual(response.status_code, 400)
        mock_urlopen.assert_not_called()

    def test_valid_repo_creates_project(self):
        zip_bytes = _make_zip({"main.tex": b"\\documentclass{article}"})

        class FakeResponse:
            def read(self, n=-1):
                return zip_bytes

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        with patch("projects.templates_api.urllib.request.urlopen", return_value=FakeResponse()):
            response = post_json(
                self.owner, "/api/projects/from-github",
                {"name": "From GH", "owner": "someuser", "repo": "some-repo"},
            )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["name"], "From GH")
        files = {f["path"] for f in self.owner.get(f"/api/projects/{body['id']}/files").json()}
        self.assertEqual(files, {"main.tex"})

    def test_github_404_surfaces_clean_error(self):
        import urllib.error

        with patch(
            "projects.templates_api.urllib.request.urlopen",
            side_effect=urllib.error.HTTPError("url", 404, "Not Found", {}, None),
        ):
            response = post_json(
                self.owner, "/api/projects/from-github",
                {"name": "X", "owner": "nouser", "repo": "norepo"},
            )
        self.assertEqual(response.status_code, 404)

    def test_oversized_response_rejected(self):
        from .api import MAX_ZIP_BYTES

        oversized = b"0" * (MAX_ZIP_BYTES + 1)

        class FakeResponse:
            def read(self, n=-1):
                return oversized[:n] if n and n > 0 else oversized

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        with patch("projects.templates_api.urllib.request.urlopen", return_value=FakeResponse()):
            response = post_json(
                self.owner, "/api/projects/from-github",
                {"name": "X", "owner": "someuser", "repo": "bigrepo"},
            )
        self.assertEqual(response.status_code, 413)

    def test_anonymous_cannot_import_from_github(self):
        anon = Client()
        post_json(anon, "/api/auth/anonymous", {})
        with patch("projects.templates_api.urllib.request.urlopen") as mock_urlopen:
            response = post_json(anon, "/api/projects/from-github", {"name": "X", "owner": "a", "repo": "b"})
        self.assertEqual(response.status_code, 403)
        mock_urlopen.assert_not_called()


class TemplateCrudTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        _login_new_user(self.admin, "admin@example.com", is_admin=True)
        self.regular = Client()
        _login_new_user(self.regular, "regular@example.com")

    def _upload(self, client, name="My Template", source_url="https://example.com/t"):
        # name/source_url/etc. are query params, not multipart form fields —
        # matching files_api.py's upload_file's exact same convention (a
        # scalar param alongside a File() param defaults to query, per
        # django-ninja).
        from urllib.parse import urlencode

        zip_bytes = _make_zip({"main.tex": b"x"})
        data = {"file": SimpleUploadedFile("t.zip", zip_bytes, content_type="application/zip")}
        query = urlencode({"name": name, "source_url": source_url})
        return client.post(f"/api/templates?{query}", data)

    def test_admin_only_mode_blocks_regular_user(self):
        response = self._upload(self.regular)
        self.assertEqual(response.status_code, 403)

    def test_admin_only_mode_allows_admin_and_publishes_immediately(self):
        response = self._upload(self.admin)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["is_published"])

        listed = self.regular.get("/api/templates").json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["name"], "My Template")

    def test_review_required_mode_holds_regular_submission_for_approval(self):
        s = SiteSettings.load()
        s.template_contribution_mode = SiteSettings.TemplateContributionMode.REVIEW_REQUIRED
        s.save(update_fields=["template_contribution_mode"])

        response = self._upload(self.regular)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["is_published"])

        self.assertEqual(self.regular.get("/api/templates").json(), [])
        all_templates = self.admin.get("/api/templates/all").json()
        self.assertEqual(len(all_templates), 1)
        self.assertFalse(all_templates[0]["is_published"])

        publish = patch_json(self.admin, f"/api/templates/{all_templates[0]['id']}", {"is_published": True})
        self.assertEqual(publish.status_code, 200)
        self.assertTrue(publish.json()["is_published"])
        self.assertEqual(len(self.regular.get("/api/templates").json()), 1)

    def test_open_mode_publishes_regular_submission_immediately(self):
        s = SiteSettings.load()
        s.template_contribution_mode = SiteSettings.TemplateContributionMode.OPEN
        s.save(update_fields=["template_contribution_mode"])

        response = self._upload(self.regular)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()["is_published"])
        self.assertEqual(len(self.regular.get("/api/templates").json()), 1)

    def test_regular_user_cannot_see_all_templates(self):
        response = self.regular.get("/api/templates/all")
        self.assertEqual(response.status_code, 403)

    def test_admin_sees_unpublished_and_published_in_all_templates(self):
        s = SiteSettings.load()
        s.template_contribution_mode = SiteSettings.TemplateContributionMode.REVIEW_REQUIRED
        s.save(update_fields=["template_contribution_mode"])
        self._upload(self.regular, name="Pending One")
        s.template_contribution_mode = SiteSettings.TemplateContributionMode.ADMIN_ONLY
        s.save(update_fields=["template_contribution_mode"])
        self._upload(self.admin, name="Published One")

        all_templates = {t["name"]: t["is_published"] for t in self.admin.get("/api/templates/all").json()}
        self.assertEqual(all_templates, {"Pending One": False, "Published One": True})

    def test_missing_source_url_rejected(self):
        response = self._upload(self.admin, source_url="")
        self.assertEqual(response.status_code, 400)

    def test_admin_can_edit_template_fields(self):
        create = self._upload(self.admin)
        template_id = create.json()["id"]
        response = patch_json(
            self.admin, f"/api/templates/{template_id}",
            {"name": "Renamed", "description": "New desc", "source_url": "https://example.com/new", "category": "thesis"},
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["name"], "Renamed")
        self.assertEqual(body["description"], "New desc")
        self.assertEqual(body["source_url"], "https://example.com/new")
        self.assertEqual(body["category"], "thesis")

    def test_edit_is_partial_untouched_fields_unchanged(self):
        create = self._upload(self.admin, name="Original", source_url="https://example.com/orig")
        template_id = create.json()["id"]
        response = patch_json(self.admin, f"/api/templates/{template_id}", {"category": "conference"})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["name"], "Original")
        self.assertEqual(body["source_url"], "https://example.com/orig")
        self.assertEqual(body["category"], "conference")

    def test_blank_name_rejected_on_edit(self):
        create = self._upload(self.admin)
        template_id = create.json()["id"]
        response = patch_json(self.admin, f"/api/templates/{template_id}", {"name": "   "})
        self.assertEqual(response.status_code, 400)

    def test_regular_user_cannot_edit_template(self):
        create = self._upload(self.admin)
        template_id = create.json()["id"]
        response = patch_json(self.regular, f"/api/templates/{template_id}", {"name": "Hacked"})
        self.assertEqual(response.status_code, 403)

    def test_edit_nonexistent_template_404s(self):
        response = patch_json(
            self.admin, "/api/templates/00000000-0000-0000-0000-000000000000", {"name": "X"},
        )
        self.assertEqual(response.status_code, 404)

    def test_admin_can_delete_template(self):
        create = self._upload(self.admin)
        template_id = create.json()["id"]
        response = self.admin.delete(f"/api/templates/{template_id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Template.objects.filter(id=template_id).exists())

    def test_regular_user_cannot_delete_template(self):
        create = self._upload(self.admin)
        template_id = create.json()["id"]
        response = self.regular.delete(f"/api/templates/{template_id}")
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Template.objects.filter(id=template_id).exists())

    def test_anonymous_cannot_browse_templates(self):
        self._upload(self.admin)
        anon = Client()
        post_json(anon, "/api/auth/anonymous", {})
        response = anon.get("/api/templates")
        self.assertEqual(response.status_code, 403)
