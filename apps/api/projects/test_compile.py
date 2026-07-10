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

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import CompileRun, ProjectSettings


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)


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
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def test_defaults_to_pdflatex_and_main_tex(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["compiler"], "pdflatex")
        self.assertEqual(body["main_doc_path"], "main.tex")
        self.assertEqual(body["bib_engine"], "bibtex")

    def test_switching_bib_engine_persists(self):
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"bib_engine": "biber"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["bib_engine"], "biber")
        again = self.owner.get(f"/api/projects/{self.project_id}/settings")
        self.assertEqual(again.json()["bib_engine"], "biber")

    def test_invalid_bib_engine_rejected(self):
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"bib_engine": "natbib"})
        self.assertEqual(response.status_code, 400)

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
        _login_new_user(self.owner, "owner@example.com")
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
    def test_failed_compile_populates_parsed_errors(self, mock_dispatch):
        mock_dispatch.return_value = {
            "status": "failed",
            "log": "(./main.tex\n! Undefined control sequence.\nl.3 \\bogus\n",
            "pdf_base64": None,
            "synctex_base64": None,
            "duration_ms": 50,
            "exit_code": 12,
            "compiler": "pdflatex",
        }
        response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        body = response.json()
        self.assertEqual(len(body["errors"]), 1)
        self.assertEqual(body["errors"][0]["message"], "Undefined control sequence.")
        self.assertEqual(body["errors"][0]["file"], "main.tex")
        self.assertEqual(body["errors"][0]["line"], 3)
        self.assertEqual(body["warnings"], [])

        run = CompileRun.objects.get(id=body["id"])
        self.assertEqual(run.errors[0]["message"], "Undefined control sequence.")

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


class SyncTexTests(ApiTestCase):
    """Mocks _dispatch_synctex() (the HTTP call to apps/compile's
    /synctex/forward and /synctex/backward), matching the same
    dispatch_compile()-mocking convention used above."""

    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]
        with patch("projects.compile_api.dispatch_compile") as mock_dispatch:
            mock_dispatch.return_value = {**FAKE_SUCCESS, "synctex_base64": "aGVsbG8="}  # "hello"
            run_response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        self.run_id = run_response.json()["id"]

    def test_requires_login(self):
        response = Client().get(
            f"/api/projects/{self.project_id}/compile-runs/{self.run_id}/synctex/forward",
            {"file": "main.tex", "line": 3},
        )
        self.assertEqual(response.status_code, 401)

    @patch("projects.compile_api._dispatch_synctex")
    def test_forward_search_returns_pdf_position(self, mock_dispatch):
        mock_dispatch.return_value = {
            "page": 1, "x": 231.5, "y": 134.7, "h": 133.7, "v": 137.2, "width": 343.7, "height": 9.9,
        }
        response = self.owner.get(
            f"/api/projects/{self.project_id}/compile-runs/{self.run_id}/synctex/forward",
            {"file": "main.tex", "line": 3},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["page"], 1)
        called_body = mock_dispatch.call_args.args[1]
        self.assertEqual(called_body["file"], "main.tex")
        self.assertEqual(called_body["line"], 3)

    @patch("projects.compile_api._dispatch_synctex")
    def test_backward_search_returns_source_position(self, mock_dispatch):
        mock_dispatch.return_value = {"file": "main.tex", "line": 3, "column": -1}
        response = self.owner.get(
            f"/api/projects/{self.project_id}/compile-runs/{self.run_id}/synctex/backward",
            {"page": 1, "x": 231.5, "y": 134.7},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["file"], "main.tex")

    @patch("projects.compile_api._dispatch_synctex")
    def test_no_record_returns_404(self, mock_dispatch):
        mock_dispatch.return_value = None
        response = self.owner.get(
            f"/api/projects/{self.project_id}/compile-runs/{self.run_id}/synctex/forward",
            {"file": "main.tex", "line": 999},
        )
        self.assertEqual(response.status_code, 404)

    def test_viewer_can_use_synctex(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        with patch("projects.compile_api._dispatch_synctex") as mock_dispatch:
            mock_dispatch.return_value = {"page": 1, "x": 0, "y": 0, "h": 0, "v": 0, "width": 0, "height": 0}
            response = viewer.get(
                f"/api/projects/{self.project_id}/compile-runs/{self.run_id}/synctex/forward",
                {"file": "main.tex", "line": 1},
            )
        self.assertEqual(response.status_code, 200)

    def test_run_without_synctex_data_gets_404(self):
        with patch("projects.compile_api.dispatch_compile") as mock_dispatch:
            mock_dispatch.return_value = {**FAKE_SUCCESS, "synctex_base64": None}
            run_response = post_json(self.owner, f"/api/projects/{self.project_id}/compile")
        no_synctex_run_id = run_response.json()["id"]
        response = self.owner.get(
            f"/api/projects/{self.project_id}/compile-runs/{no_synctex_run_id}/synctex/forward",
            {"file": "main.tex", "line": 1},
        )
        self.assertEqual(response.status_code, 404)
