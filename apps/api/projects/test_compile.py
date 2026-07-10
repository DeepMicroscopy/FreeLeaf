"""Fast, CI-friendly tests for the compile trigger/settings API.

These mock dispatch_compile() (the HTTP call to apps/compile) so they don't
need Docker-in-Docker or a real TeX Live image — that real, unmocked path
(sandbox behavior: shell-escape blocked, timeout enforced, path traversal
rejected, both engines actually produce a PDF) is exercised by
apps/compile's own integration test run against a live stack; see
Status.md's Phase 3 entry for that verification. This file covers the
apps/api side: authorization, settings persistence, CompileRun bookkeeping,
and error handling when the compile service itself fails.
"""

import json
from unittest.mock import patch

from django.core import mail
from django.test import Client

from core.testing import ApiTestCase

from .models import CompileRun, ProjectSettings


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_via_magic_link(client, email):
    post_json(client, "/api/auth/magic-link/request", {"email": email})
    token = mail.outbox[-1].body.split("token=")[1].split()[0].strip()
    post_json(client, "/api/auth/magic-link/verify", {"token": token})


FAKE_SUCCESS = {
    "status": "success",
    "log": "all good",
    "pdf_base64": "JVBERi0xLjQK",  # "%PDF-1.4\n"
    "synctex_base64": None,
    "duration_ms": 123,
    "exit_code": 0,
    "compiler": "pdflatex",
}


class ProjectSettingsTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_via_magic_link(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def test_defaults_to_pdflatex_and_main_tex(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["compiler"], "pdflatex")
        self.assertEqual(body["main_doc_path"], "main.tex")

    def test_settings_row_is_created_lazily_once(self):
        self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.assertEqual(ProjectSettings.objects.filter(project_id=self.project_id).count(), 1)

    def test_switching_compiler_persists(self):
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["compiler"], "xelatex")
        again = self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.assertEqual(again.json()["compiler"], "xelatex")

    def test_invalid_compiler_rejected(self):
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"compiler": "luatex"})
        self.assertEqual(response.status_code, 400)

    def test_invalid_main_doc_path_rejected(self):
        response = patch_json(
            self.owner, f"/api/projects/{self.project_id}/settings", {"main_doc_path": "../evil.tex"}
        )
        self.assertEqual(response.status_code, 400)

    def test_viewer_cannot_change_settings(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        response = patch_json(viewer, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        self.assertEqual(response.status_code, 403)


class TriggerCompileTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_via_magic_link(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def test_requires_login(self):
        response = post_json(Client(), f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 401)

    def test_viewer_cannot_trigger_compile(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        with patch("projects.compile_api.dispatch_compile") as mock_dispatch:
            response = post_json(viewer, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 403)
        mock_dispatch.assert_not_called()

    @patch("projects.compile_api.dispatch_compile")
    def test_successful_compile_creates_run_and_stores_pdf(self, mock_dispatch):
        mock_dispatch.return_value = FAKE_SUCCESS
        response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "success")
        self.assertTrue(body["has_pdf"])

        run = CompileRun.objects.get(id=body["id"])
        self.assertEqual(run.status, "success")
        self.assertIsNotNone(run.pdf_key)

        pdf_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{run.id}/pdf")
        self.assertEqual(pdf_response.status_code, 200)
        self.assertEqual(pdf_response.content, b"%PDF-1.4\n")

        log_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{run.id}/log")
        self.assertEqual(log_response.status_code, 200)
        self.assertIn(b"all good", log_response.content)

    @patch("projects.compile_api.dispatch_compile")
    def test_failed_compile_has_no_pdf(self, mock_dispatch):
        mock_dispatch.return_value = {
            "status": "failed",
            "log": "! Undefined control sequence.",
            "pdf_base64": None,
            "synctex_base64": None,
            "duration_ms": 50,
            "exit_code": 12,
            "compiler": "pdflatex",
        }
        response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "failed")
        self.assertFalse(body["has_pdf"])

        run_id = body["id"]
        pdf_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{run_id}/pdf")
        self.assertEqual(pdf_response.status_code, 404)

    @patch("projects.compile_api.dispatch_compile")
    def test_compile_uses_the_projects_configured_compiler(self, mock_dispatch):
        mock_dispatch.return_value = {**FAKE_SUCCESS, "compiler": "xelatex"}
        patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        called_compiler = mock_dispatch.call_args.args[1]
        self.assertEqual(called_compiler, "xelatex")

    def test_stranger_without_access_gets_404(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        with patch("projects.compile_api.dispatch_compile") as mock_dispatch:
            response = post_json(stranger, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 404)
        mock_dispatch.assert_not_called()

    def test_list_compile_runs_requires_membership(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = stranger.get(f"/api/projects/{self.project_id}/compile-runs")
        self.assertEqual(response.status_code, 404)
