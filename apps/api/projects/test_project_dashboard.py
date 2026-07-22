"""Project-overview dashboard additions: page-1 thumbnails generated on
successful compile, the project-level "latest PDF" endpoint, and
duplicating a project. Thumbnail generation is exercised with a real
single-page PDF (built via PyMuPDF itself, the simplest way to get bytes
fitz can actually open) rather than compile_api's own FAKE_SUCCESS fixture,
whose "%PDF-1.4\\n" stub is intentionally not a valid renderable PDF.
"""

import json
from unittest.mock import patch

import fitz
from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Project

def _one_page_pdf() -> bytes:
    doc = fitz.open()
    doc.new_page()
    return doc.tobytes()


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)


class ThumbnailAndLatestPdfTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    @patch("projects.compile_api.dispatch_compile")
    def test_successful_compile_generates_thumbnail(self, mock_dispatch):
        import base64

        mock_dispatch.return_value = {
            "status": "success",
            "log": "ok",
            "pdf_base64": base64.b64encode(_one_page_pdf()).decode(),
            "synctex_base64": None,
            "duration_ms": 1,
            "exit_code": 0,
            "compiler": "pdflatex",
        }
        response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 200)

        project = Project.objects.get(id=self.project_id)
        self.assertIsNotNone(project.thumbnail_storage_key)

        thumb = self.owner.get(f"/api/projects/{self.project_id}/thumbnail")
        self.assertEqual(thumb.status_code, 200)
        self.assertEqual(thumb["Content-Type"], "image/png")
        self.assertTrue(thumb.content.startswith(b"\x89PNG"))

    def test_no_thumbnail_before_any_compile(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/thumbnail")
        self.assertEqual(response.status_code, 404)

    @patch("projects.compile_api.dispatch_compile")
    def test_thumbnail_generation_failure_does_not_break_compile(self, mock_dispatch):
        mock_dispatch.return_value = {
            "status": "success",
            "log": "ok",
            "pdf_base64": "JVBERi0xLjQK",  # not a real/renderable PDF
            "synctex_base64": None,
            "duration_ms": 1,
            "exit_code": 0,
            "compiler": "pdflatex",
        }
        response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "success")
        self.assertIsNone(Project.objects.get(id=self.project_id).thumbnail_storage_key)

    def test_latest_pdf_404s_with_no_successful_run(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/pdf")
        self.assertEqual(response.status_code, 404)

    @patch("projects.compile_api.dispatch_compile")
    def test_latest_pdf_returns_most_recent_successful_run(self, mock_dispatch):
        import base64

        pdf_bytes = _one_page_pdf()
        mock_dispatch.return_value = {
            "status": "success",
            "log": "ok",
            "pdf_base64": base64.b64encode(pdf_bytes).decode(),
            "synctex_base64": None,
            "duration_ms": 1,
            "exit_code": 0,
            "compiler": "pdflatex",
        }
        post_json(self.owner, f"/api/projects/{self.project_id}/compile")

        response = self.owner.get(f"/api/projects/{self.project_id}/pdf")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, pdf_bytes)


class DuplicateProjectTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Original"})
        self.project_id = create.json()["id"]
        patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        post_json(
            self.owner, f"/api/projects/{self.project_id}/files",
            {"path": "extra.tex", "content": "\\section{Extra}"},
        )

    def test_duplicate_copies_files_and_settings_to_a_new_project(self):
        response = post_json(self.owner, f"/api/projects/{self.project_id}/duplicate")
        self.assertEqual(response.status_code, 200)
        new_project_id = response.json()["id"]
        self.assertNotEqual(new_project_id, self.project_id)
        self.assertEqual(response.json()["name"], "Original (copy)")
        self.assertEqual(response.json()["role"], "owner")

        files = self.owner.get(f"/api/projects/{new_project_id}/files").json()
        paths = {f["path"] for f in files}
        self.assertEqual(paths, {"main.tex", "extra.tex"})

        settings = self.owner.get(f"/api/projects/{new_project_id}/settings").json()
        self.assertEqual(settings["compiler"], "xelatex")

    def test_duplicate_accepts_a_custom_name(self):
        response = post_json(self.owner, f"/api/projects/{self.project_id}/duplicate", {"name": "My copy"})
        self.assertEqual(response.json()["name"], "My copy")

    def test_anonymous_share_link_member_cannot_duplicate(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "editor"})
        anon = Client()
        post_json(anon, f"/api/share-links/{link.json()['token']}/join", {})
        response = post_json(anon, f"/api/projects/{self.project_id}/duplicate")
        self.assertEqual(response.status_code, 403)
