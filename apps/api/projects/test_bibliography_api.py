import json

from django.test import Client

from accounts.models import User
from core import storage
from core.testing import ApiTestCase, login_as

from .models import ProjectFile, ProjectSettings


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)


class BibliographyBootstrapTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def test_creates_default_references_bib_on_first_access(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/bibliography")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["path"], "references.bib")

        f = ProjectFile.objects.get(id=body["file_id"])
        self.assertEqual(storage.get_object(f.storage_key), b"")

        settings_row = ProjectSettings.objects.get(project_id=self.project_id)
        self.assertEqual(settings_row.central_bib_path, "references.bib")

    def test_is_idempotent_and_returns_the_same_file(self):
        first = self.owner.get(f"/api/projects/{self.project_id}/bibliography").json()
        second = self.owner.get(f"/api/projects/{self.project_id}/bibliography").json()
        self.assertEqual(first["file_id"], second["file_id"])
        self.assertEqual(ProjectFile.objects.filter(project_id=self.project_id, type="bib").count(), 1)

    def test_honors_an_already_configured_central_bib_path(self):
        post_json(self.owner, f"/api/projects/{self.project_id}/files", {"path": "mylib.bib", "content": "@x"})
        patch = self.owner.patch(
            f"/api/projects/{self.project_id}/settings",
            data=json.dumps({"central_bib_path": "mylib.bib"}),
            content_type="application/json",
        )
        self.assertEqual(patch.status_code, 200)

        response = self.owner.get(f"/api/projects/{self.project_id}/bibliography")
        self.assertEqual(response.json()["path"], "mylib.bib")
        self.assertEqual(ProjectFile.objects.filter(project_id=self.project_id, type="bib").count(), 1)

    def test_requires_login(self):
        response = Client().get(f"/api/projects/{self.project_id}/bibliography")
        self.assertEqual(response.status_code, 401)

    def test_stranger_without_access_gets_404(self):
        stranger = Client()
        _login_new_user(stranger, "stranger@example.com")
        response = stranger.get(f"/api/projects/{self.project_id}/bibliography")
        self.assertEqual(response.status_code, 404)
