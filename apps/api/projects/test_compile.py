"""Fast, CI-friendly tests for the compile trigger/settings API.

These mock dispatch_compile_start()/dispatch_compile_status() (the two HTTP
calls to apps/compile, now a two-phase start/poll flow — see
compile_api.py's module docstring-equivalent comments) so they don't need
Docker-in-Docker or a real TeX Live image — that real, unmocked path
(sandbox behavior: shell-escape blocked, timeout enforced, path traversal
rejected, both engines actually produce a PDF) is exercised by
apps/compile's own integration test run against a live stack; see
Status.md's Phase 3 entry for that verification. This file covers the
apps/api side: authorization, settings persistence, CompileRun bookkeeping,
and error handling when the compile service itself fails.
"""

import json
import uuid
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


def start_compile(client, project_id, job_id=None):
    """Patches dispatch_compile_start to return a fixed job_id (a fresh
    random one by default) and POSTs /compile. Returns (response, job_id) —
    the mock is only active for this one call, matching how a real
    dispatch_compile_start call is a single fire-and-forget POST."""
    job_id = job_id or uuid.uuid4().hex
    with patch("projects.compile_api.dispatch_compile_start", return_value=job_id) as mock_start:
        response = post_json(client, f"/api/projects/{project_id}/compile")
    return response, job_id, mock_start


def poll_progress(client, project_id, job_id, *, done=True, steps=None, result=None, error=None):
    """Patches dispatch_compile_status to return a fixed status payload and
    GETs the progress endpoint once. Mirrors what a single frontend poll
    round does."""
    status = {"done": done, "steps": steps or [], "result": result, "error": error}
    with patch("projects.compile_api.dispatch_compile_status", return_value=status):
        return client.get(f"/api/projects/{project_id}/compile/{job_id}/progress")


def compile_and_finish(client, project_id, result):
    """Runs the full two-phase start+poll flow with the compile service's
    eventual result fixed at `result`, returning the finalized run dict
    (`progress.json()["run"]`) for tests that only care about the end state
    — equivalent to the old single blocking POST /compile response."""
    _start_response, job_id, _ = start_compile(client, project_id)
    progress = poll_progress(client, project_id, job_id, done=True, result=result)
    return progress.json()["run"]


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
        response, _job_id, mock_start = start_compile(viewer, self.project_id)
        self.assertEqual(response.status_code, 403)
        mock_start.assert_not_called()

    def test_start_compile_returns_a_job_id(self):
        response, job_id, _ = start_compile(self.owner, self.project_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job_id"], job_id)

    def test_successful_compile_creates_run_and_stores_pdf(self):
        run = compile_and_finish(self.owner, self.project_id, FAKE_SUCCESS)
        self.assertEqual(run["status"], "success")
        self.assertTrue(run["has_pdf"])

        db_run = CompileRun.objects.get(id=run["id"])
        self.assertEqual(db_run.status, "success")
        self.assertIsNotNone(db_run.pdf_key)

        pdf_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{db_run.id}/pdf")
        self.assertEqual(pdf_response.status_code, 200)
        self.assertEqual(pdf_response.content, b"%PDF-1.4\n")

        log_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{db_run.id}/log")
        self.assertEqual(log_response.status_code, 200)
        self.assertIn(b"all good", log_response.content)

    def test_failed_compile_has_no_pdf(self):
        run = compile_and_finish(
            self.owner,
            self.project_id,
            {
                "status": "failed",
                "log": "! Undefined control sequence.",
                "pdf_base64": None,
                "synctex_base64": None,
                "duration_ms": 50,
                "exit_code": 12,
                "compiler": "pdflatex",
            },
        )
        self.assertEqual(run["status"], "failed")
        self.assertFalse(run["has_pdf"])

        pdf_response = self.owner.get(f"/api/projects/{self.project_id}/compile-runs/{run['id']}/pdf")
        self.assertEqual(pdf_response.status_code, 404)

    def test_failed_compile_populates_parsed_errors(self):
        run = compile_and_finish(
            self.owner,
            self.project_id,
            {
                "status": "failed",
                "log": "(./main.tex\n! Undefined control sequence.\nl.3 \\bogus\n",
                "pdf_base64": None,
                "synctex_base64": None,
                "duration_ms": 50,
                "exit_code": 12,
                "compiler": "pdflatex",
            },
        )
        self.assertEqual(len(run["errors"]), 1)
        self.assertEqual(run["errors"][0]["message"], "Undefined control sequence: \\bogus")
        self.assertEqual(run["errors"][0]["file"], "main.tex")
        self.assertEqual(run["errors"][0]["line"], 3)
        self.assertEqual(run["warnings"], [])

        db_run = CompileRun.objects.get(id=run["id"])
        self.assertEqual(db_run.errors[0]["message"], "Undefined control sequence: \\bogus")

    def test_compile_uses_the_projects_configured_compiler(self):
        patch_json(self.owner, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        _response, _job_id, mock_start = start_compile(self.owner, self.project_id)
        called_compiler = mock_start.call_args.args[1]
        self.assertEqual(called_compiler, "xelatex")

    def test_stranger_without_access_gets_404(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response, _job_id, mock_start = start_compile(stranger, self.project_id)
        self.assertEqual(response.status_code, 404)
        mock_start.assert_not_called()

    def test_list_compile_runs_requires_membership(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = stranger.get(f"/api/projects/{self.project_id}/compile-runs")
        self.assertEqual(response.status_code, 404)


class CompileProgressTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def test_in_progress_poll_returns_steps_without_a_run(self):
        _response, job_id, _ = start_compile(self.owner, self.project_id)
        progress = poll_progress(
            self.owner, self.project_id, job_id, done=False, steps=["pdfTeX run 1"]
        )
        self.assertEqual(progress.status_code, 200)
        body = progress.json()
        self.assertFalse(body["done"])
        self.assertEqual(body["steps"], ["pdfTeX run 1"])
        self.assertIsNone(body["run"])

    def test_polling_twice_after_done_does_not_create_a_second_run(self):
        _response, job_id, _ = start_compile(self.owner, self.project_id)
        first = poll_progress(self.owner, self.project_id, job_id, done=True, result=FAKE_SUCCESS)
        second = poll_progress(self.owner, self.project_id, job_id, done=True, result=FAKE_SUCCESS)
        self.assertEqual(first.json()["run"]["id"], second.json()["run"]["id"])
        self.assertEqual(CompileRun.objects.filter(job_id=job_id).count(), 1)

    def test_compile_service_error_is_surfaced_without_creating_a_run(self):
        _response, job_id, _ = start_compile(self.owner, self.project_id)
        progress = poll_progress(self.owner, self.project_id, job_id, done=True, error="sandbox exploded")
        self.assertEqual(progress.status_code, 200)
        body = progress.json()
        self.assertTrue(body["done"])
        self.assertEqual(body["error"], "sandbox exploded")
        self.assertIsNone(body["run"])
        self.assertEqual(CompileRun.objects.filter(job_id=job_id).count(), 0)

    def test_stranger_cannot_poll_progress(self):
        _response, job_id, _ = start_compile(self.owner, self.project_id)
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = stranger.get(f"/api/projects/{self.project_id}/compile/{job_id}/progress")
        self.assertEqual(response.status_code, 404)


class SyncTexTests(ApiTestCase):
    """Mocks _dispatch_synctex() (the HTTP call to apps/compile's
    /synctex/forward and /synctex/backward), matching the same
    dispatch_compile_start()/dispatch_compile_status()-mocking convention
    used above."""

    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]
        run = compile_and_finish(self.owner, self.project_id, {**FAKE_SUCCESS, "synctex_base64": "aGVsbG8="})
        self.run_id = run["id"]

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
        run = compile_and_finish(self.owner, self.project_id, {**FAKE_SUCCESS, "synctex_base64": None})
        no_synctex_run_id = run["id"]
        response = self.owner.get(
            f"/api/projects/{self.project_id}/compile-runs/{no_synctex_run_id}/synctex/forward",
            {"file": "main.tex", "line": 1},
        )
        self.assertEqual(response.status_code, 404)
