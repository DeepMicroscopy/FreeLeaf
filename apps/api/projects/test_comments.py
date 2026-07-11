"""Tests for comments (Plan.md §9 Phase 8)."""

import json

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Comment, ProjectFile


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


class CommentTestsBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        self.owner_user = _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]
        self.file_id = str(ProjectFile.objects.get(project_id=self.project_id, path="main.tex").id)

    def _add_editor(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "editor"})
        editor = Client()
        post_json(editor, f"/api/share-links/{link.json()['token']}/join", {})
        return editor

    def _add_viewer(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        return viewer


class CreateCommentTests(CommentTestsBase):
    def test_requires_login(self):
        response = post_json(
            Client(), f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "hi", "anchor_line": 3}
        )
        self.assertEqual(response.status_code, 401)

    def test_owner_can_comment(self):
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "hi", "anchor_line": 3}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["anchor_line"], 3)
        self.assertEqual(body["body"], "hi")
        self.assertTrue(body["is_you"])
        self.assertTrue(body["can_delete"])
        self.assertFalse(body["resolved"])
        self.assertEqual(body["replies"], [])

    def test_viewer_can_comment_too(self):
        viewer = self._add_viewer()
        response = post_json(
            viewer, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "viewer comment", "anchor_line": 1}
        )
        self.assertEqual(response.status_code, 200)

    def test_empty_body_rejected(self):
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "   ", "anchor_line": 1}
        )
        self.assertEqual(response.status_code, 400)

    def test_reply_inherits_anchor_line(self):
        top = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "top", "anchor_line": 5}
        ).json()
        reply = post_json(
            self.owner,
            f"/api/projects/{self.project_id}/files/{self.file_id}/comments",
            {"body": "a reply", "anchor_line": 999, "parent_id": top["id"]},
        )
        self.assertEqual(reply.status_code, 200)

        listing = self.owner.get(f"/api/projects/{self.project_id}/files/{self.file_id}/comments").json()
        self.assertEqual(len(listing), 1)
        self.assertEqual(listing[0]["anchor_line"], 5)
        self.assertEqual(len(listing[0]["replies"]), 1)
        self.assertEqual(listing[0]["replies"][0]["body"], "a reply")

    def test_reply_to_a_reply_rejected(self):
        top = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "top", "anchor_line": 1}
        ).json()
        reply = post_json(
            self.owner,
            f"/api/projects/{self.project_id}/files/{self.file_id}/comments",
            {"body": "reply", "anchor_line": 1, "parent_id": top["id"]},
        ).json()
        nested = post_json(
            self.owner,
            f"/api/projects/{self.project_id}/files/{self.file_id}/comments",
            {"body": "nested reply", "anchor_line": 1, "parent_id": reply["id"]},
        )
        self.assertEqual(nested.status_code, 400)

    def test_stranger_gets_404(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = post_json(
            stranger, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "hi", "anchor_line": 1}
        )
        self.assertEqual(response.status_code, 404)


class ListCommentsTests(CommentTestsBase):
    def test_lists_oldest_first(self):
        post_json(self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "one", "anchor_line": 1})
        post_json(self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "two", "anchor_line": 2})
        response = self.owner.get(f"/api/projects/{self.project_id}/files/{self.file_id}/comments")
        self.assertEqual([c["body"] for c in response.json()], ["one", "two"])

    def test_editor_sees_owners_comments_and_vice_versa(self):
        editor = self._add_editor()
        post_json(self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "from owner", "anchor_line": 1})
        response = editor.get(f"/api/projects/{self.project_id}/files/{self.file_id}/comments")
        self.assertEqual(len(response.json()), 1)
        self.assertFalse(response.json()[0]["is_you"])
        self.assertFalse(response.json()[0]["can_delete"])


class ResolveCommentTests(CommentTestsBase):
    def _make_comment(self):
        return post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "hi", "anchor_line": 1}
        ).json()

    def test_owner_can_resolve(self):
        comment = self._make_comment()
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/comments/{comment['id']}/resolve", {"resolved": True})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["resolved"])
        self.assertIsNotNone(body["resolved_at"])
        self.assertEqual(body["resolved_by_name"], "owner@example.com")

    def test_editor_can_resolve(self):
        editor = self._add_editor()
        comment = self._make_comment()
        response = patch_json(editor, f"/api/projects/{self.project_id}/comments/{comment['id']}/resolve", {"resolved": True})
        self.assertEqual(response.status_code, 200)

    def test_viewer_cannot_resolve(self):
        viewer = self._add_viewer()
        comment = self._make_comment()
        response = patch_json(viewer, f"/api/projects/{self.project_id}/comments/{comment['id']}/resolve", {"resolved": True})
        self.assertEqual(response.status_code, 403)

    def test_unresolve(self):
        comment = self._make_comment()
        patch_json(self.owner, f"/api/projects/{self.project_id}/comments/{comment['id']}/resolve", {"resolved": True})
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/comments/{comment['id']}/resolve", {"resolved": False})
        body = response.json()
        self.assertFalse(body["resolved"])
        self.assertIsNone(body["resolved_at"])
        self.assertIsNone(body["resolved_by_name"])

    def test_cannot_resolve_a_reply(self):
        top = self._make_comment()
        reply = post_json(
            self.owner,
            f"/api/projects/{self.project_id}/files/{self.file_id}/comments",
            {"body": "reply", "anchor_line": 1, "parent_id": top["id"]},
        ).json()
        response = patch_json(self.owner, f"/api/projects/{self.project_id}/comments/{reply['id']}/resolve", {"resolved": True})
        self.assertEqual(response.status_code, 400)


class DeleteCommentTests(CommentTestsBase):
    def test_author_can_delete_own_comment(self):
        editor = self._add_editor()
        comment = post_json(
            editor, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "mine", "anchor_line": 1}
        ).json()
        response = editor.delete(f"/api/projects/{self.project_id}/comments/{comment['id']}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Comment.objects.filter(id=comment["id"]).exists())

    def test_owner_can_delete_anyones_comment(self):
        editor = self._add_editor()
        comment = post_json(
            editor, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "editor's", "anchor_line": 1}
        ).json()
        response = self.owner.delete(f"/api/projects/{self.project_id}/comments/{comment['id']}")
        self.assertEqual(response.status_code, 200)

    def test_non_owner_cannot_delete_others_comment(self):
        editor = self._add_editor()
        comment = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "owner's", "anchor_line": 1}
        ).json()
        response = editor.delete(f"/api/projects/{self.project_id}/comments/{comment['id']}")
        self.assertEqual(response.status_code, 403)

    def test_deleting_top_level_comment_deletes_replies(self):
        top = post_json(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/comments", {"body": "top", "anchor_line": 1}
        ).json()
        post_json(
            self.owner,
            f"/api/projects/{self.project_id}/files/{self.file_id}/comments",
            {"body": "reply", "anchor_line": 1, "parent_id": top["id"]},
        )
        self.owner.delete(f"/api/projects/{self.project_id}/comments/{top['id']}")
        self.assertEqual(Comment.objects.filter(project_id=self.project_id).count(), 0)
