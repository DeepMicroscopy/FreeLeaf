import json

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Membership, Project, Role


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


class TransferOwnershipTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        self.owner_user = _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

        self.editor_user = User.objects.create(kind=User.Kind.EMAIL, email="editor@example.com")
        Membership.objects.create(project_id=self.project_id, user=self.editor_user, role=Role.EDITOR)
        self.editor = Client()
        login_as(self.editor, self.editor_user)

    def test_transfer_demotes_caller_and_promotes_target(self):
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/members/{self.editor_user.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 200)
        by_id = {m["user_id"]: m for m in response.json()}
        self.assertEqual(by_id[str(self.editor_user.id)]["role"], "owner")
        self.assertEqual(by_id[str(self.owner_user.id)]["role"], "editor")

        self.assertEqual(
            Membership.objects.get(project_id=self.project_id, user=self.editor_user).role, Role.OWNER
        )
        self.assertEqual(
            Membership.objects.get(project_id=self.project_id, user=self.owner_user).role, Role.EDITOR
        )
        self.assertEqual(Project.objects.get(id=self.project_id).owner_id, self.editor_user.id)

    def test_former_owner_can_no_longer_manage_members(self):
        post_json(self.owner, f"/api/projects/{self.project_id}/members/{self.editor_user.id}/transfer-ownership")
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/members/{self.editor_user.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 403)

    def test_non_owner_cannot_transfer(self):
        response = post_json(
            self.editor, f"/api/projects/{self.project_id}/members/{self.owner_user.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 403)

    def test_cannot_transfer_to_the_current_owner(self):
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/members/{self.owner_user.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 400)

    def test_cannot_transfer_to_a_non_member(self):
        stranger = User.objects.create(kind=User.Kind.EMAIL, email="stranger@example.com")
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/members/{stranger.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 404)

    def test_requires_login(self):
        response = post_json(
            Client(), f"/api/projects/{self.project_id}/members/{self.editor_user.id}/transfer-ownership"
        )
        self.assertEqual(response.status_code, 401)
