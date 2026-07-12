import json

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Membership, ProjectFile, Role


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def put_json(client, url, data=None):
    return client.put(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


class ReviewerRoleTests(ApiTestCase):
    """A reviewer can read everything a viewer can, plus join the live
    collab document (their edits become tracked suggestions client-side —
    see suggestionRewrite.ts), but gets none of an editor's direct-write
    endpoints: no file management, no settings, no compile, no member/
    share-link management."""

    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Paper"})
        self.project_id = create.json()["id"]
        self.main_tex_id = ProjectFile.objects.get(project_id=self.project_id, path="main.tex").id

        self.reviewer_user = User.objects.create(kind=User.Kind.EMAIL, email="reviewer@example.com")
        Membership.objects.create(project_id=self.project_id, user=self.reviewer_user, role=Role.REVIEWER)
        self.reviewer = Client()
        login_as(self.reviewer, self.reviewer_user)

    def test_reviewer_can_list_and_read_files(self):
        response = self.reviewer.get(f"/api/projects/{self.project_id}/files")
        self.assertEqual(response.status_code, 200)
        content = self.reviewer.get(f"/api/projects/{self.project_id}/files/{self.main_tex_id}/content")
        self.assertEqual(content.status_code, 200)

    def test_reviewer_cannot_create_files(self):
        response = post_json(
            self.reviewer, f"/api/projects/{self.project_id}/files", {"path": "notes.tex", "content": "x"}
        )
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_edit_file_content_directly(self):
        response = put_json(
            self.reviewer, f"/api/projects/{self.project_id}/files/{self.main_tex_id}/content", {"content": "hacked"}
        )
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_delete_files(self):
        response = self.reviewer.delete(f"/api/projects/{self.project_id}/files/{self.main_tex_id}")
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_change_settings(self):
        response = patch_json(self.reviewer, f"/api/projects/{self.project_id}/settings", {"compiler": "xelatex"})
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_trigger_compile(self):
        response = post_json(self.reviewer, f"/api/projects/{self.project_id}/compile")
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_manage_share_links(self):
        response = post_json(self.reviewer, f"/api/projects/{self.project_id}/share-links", {"role": "editor"})
        self.assertEqual(response.status_code, 403)

    def test_reviewer_cannot_manage_members(self):
        response = self.reviewer.get(f"/api/projects/{self.project_id}/members")
        self.assertEqual(response.status_code, 403)

    def test_reviewer_can_get_a_non_readonly_collab_token(self):
        response = self.reviewer.get(f"/api/projects/{self.project_id}/files/{self.main_tex_id}/collab-token")
        self.assertEqual(response.status_code, 200)

    def test_reviewer_can_comment(self):
        response = post_json(
            self.reviewer,
            f"/api/projects/{self.project_id}/files/{self.main_tex_id}/comments",
            {"body": "looks good", "anchor_line": 1},
        )
        self.assertEqual(response.status_code, 200)

    def test_owner_can_create_a_reviewer_share_link(self):
        response = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "reviewer"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "reviewer")

    def test_joining_a_reviewer_share_link_grants_the_reviewer_role(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "reviewer"})
        token = link.json()["token"]

        joiner = Client()
        _login_new_user(joiner, "joiner@example.com")
        response = post_json(joiner, f"/api/share-links/{token}/join", {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "reviewer")

    def test_owner_can_change_a_members_role_to_reviewer(self):
        editor_user = User.objects.create(kind=User.Kind.EMAIL, email="editor@example.com")
        Membership.objects.create(project_id=self.project_id, user=editor_user, role=Role.EDITOR)

        response = patch_json(
            self.owner, f"/api/projects/{self.project_id}/members/{editor_user.id}", {"role": "reviewer"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "reviewer")
