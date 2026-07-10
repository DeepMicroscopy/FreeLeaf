import json

from django.test import Client, override_settings

from accounts.models import User
from core.collab_tokens import verify_collab_token
from core.testing import ApiTestCase, login_as

from .models import ProjectFile


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
