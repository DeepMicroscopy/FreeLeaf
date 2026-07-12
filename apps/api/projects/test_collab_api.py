import json

from django.test import Client, override_settings

from accounts.models import User
from core.collab_tokens import verify_collab_token
from core.testing import ApiTestCase, login_as

from .models import Project, ProjectFile


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


@override_settings(COLLAB_SHARED_SECRET="test-secret")
class CollabTokenTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]
        self.main_tex_id = ProjectFile.objects.get(project_id=self.project_id, path="main.tex").id

    def test_issues_a_token_scoped_to_project_file_and_role(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/files/{self.main_tex_id}/collab-token")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ws_url"])

        payload = verify_collab_token(body["token"], "test-secret")
        self.assertEqual(payload["project_id"], str(self.project_id))
        self.assertEqual(payload["file_id"], str(self.main_tex_id))
        self.assertEqual(payload["role"], "owner")

    def test_requires_login(self):
        response = Client().get(f"/api/projects/{self.project_id}/files/{self.main_tex_id}/collab-token")
        self.assertEqual(response.status_code, 401)

    def test_stranger_without_access_gets_404(self):
        stranger = Client()
        _login_new_user(stranger, "stranger@example.com")
        response = stranger.get(f"/api/projects/{self.project_id}/files/{self.main_tex_id}/collab-token")
        self.assertEqual(response.status_code, 404)

    def test_folder_is_rejected(self):
        post_json(self.owner, f"/api/projects/{self.project_id}/folders", {"path": "figures"})
        folder_id = ProjectFile.objects.get(project_id=self.project_id, path="figures").id
        response = self.owner.get(f"/api/projects/{self.project_id}/files/{folder_id}/collab-token")
        self.assertEqual(response.status_code, 400)


@override_settings(COLLAB_SHARED_SECRET="test-secret")
class CollabInternalContentTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]
        self.main_tex_id = ProjectFile.objects.get(project_id=self.project_id, path="main.tex").id

    def test_wrong_secret_is_rejected(self):
        response = self.owner.get(
            f"/api/internal/collab/files/{self.main_tex_id}/content", HTTP_X_COLLAB_SECRET="nope"
        )
        self.assertEqual(response.status_code, 401)

    def test_missing_secret_is_rejected(self):
        response = self.owner.get(f"/api/internal/collab/files/{self.main_tex_id}/content")
        self.assertEqual(response.status_code, 401)

    def test_write_then_read_round_trips(self):
        client = Client()
        response = client.put(
            f"/api/internal/collab/files/{self.main_tex_id}/content",
            data=json.dumps({"content": "hello from collab"}),
            content_type="application/json",
            HTTP_X_COLLAB_SECRET="test-secret",
        )
        self.assertEqual(response.status_code, 200)

        response = client.get(
            f"/api/internal/collab/files/{self.main_tex_id}/content", HTTP_X_COLLAB_SECRET="test-secret"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], "hello from collab")

    def test_persist_with_editor_user_id_attributes_the_project(self):
        editor = User.objects.create(kind=User.Kind.EMAIL, email="editor@example.com", display_name="Editor Person")
        client = Client()
        response = client.put(
            f"/api/internal/collab/files/{self.main_tex_id}/content",
            data=json.dumps({"content": "typed by editor", "editor_user_id": str(editor.id)}),
            content_type="application/json",
            HTTP_X_COLLAB_SECRET="test-secret",
        )
        self.assertEqual(response.status_code, 200)
        project = Project.objects.get(id=self.project_id)
        self.assertEqual(project.last_edited_by_id, editor.id)

    def test_persist_without_editor_user_id_keeps_previous_attribution(self):
        editor = User.objects.create(kind=User.Kind.EMAIL, email="editor2@example.com")
        client = Client()
        client.put(
            f"/api/internal/collab/files/{self.main_tex_id}/content",
            data=json.dumps({"content": "first", "editor_user_id": str(editor.id)}),
            content_type="application/json",
            HTTP_X_COLLAB_SECRET="test-secret",
        )
        client.put(
            f"/api/internal/collab/files/{self.main_tex_id}/content",
            data=json.dumps({"content": "second, no editor info"}),
            content_type="application/json",
            HTTP_X_COLLAB_SECRET="test-secret",
        )
        project = Project.objects.get(id=self.project_id)
        self.assertEqual(project.last_edited_by_id, editor.id)

    def test_unknown_editor_user_id_is_ignored_not_an_error(self):
        client = Client()
        response = client.put(
            f"/api/internal/collab/files/{self.main_tex_id}/content",
            data=json.dumps({"content": "x", "editor_user_id": "00000000-0000-0000-0000-000000000000"}),
            content_type="application/json",
            HTTP_X_COLLAB_SECRET="test-secret",
        )
        self.assertEqual(response.status_code, 200)
        project = Project.objects.get(id=self.project_id)
        self.assertIsNone(project.last_edited_by_id)
