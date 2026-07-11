"""Tests for version history / snapshots (Plan.md §9 Phase 8).

Mocks flush_collab_rooms() and _replace_collab_content() (the HTTP calls to
apps/collab) so these don't depend on a live collab service, matching
test_compile.py's dispatch_compile()-mocking convention.
"""

import json
from unittest.mock import patch

from django.test import Client

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import FileType, ProjectFile, ProjectSnapshot


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)
    return user


class SnapshotTestsBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        self.owner_user = _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "P"})
        self.project_id = create.json()["id"]

    def _patch_collab(self):
        return patch("projects.versions_api.flush_collab_rooms")


class CreateSnapshotTests(SnapshotTestsBase):
    def test_requires_login(self):
        response = post_json(Client(), f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        self.assertEqual(response.status_code, 401)

    def test_manual_snapshot_created_with_label(self):
        with self._patch_collab():
            response = post_json(
                self.owner,
                f"/api/projects/{self.project_id}/snapshots",
                {"kind": "manual", "label": "Draft submitted", "description": "v1"},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["kind"], "manual")
        self.assertEqual(body["label"], "Draft submitted")
        self.assertEqual(ProjectSnapshot.objects.filter(project_id=self.project_id).count(), 1)

    def test_invalid_kind_rejected(self):
        with self._patch_collab():
            response = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "bogus"})
        self.assertEqual(response.status_code, 400)

    def test_viewer_cannot_create_snapshot(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        with self._patch_collab():
            response = post_json(viewer, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        self.assertEqual(response.status_code, 403)

    def test_auto_snapshot_deduplicates_identical_content(self):
        with self._patch_collab():
            first = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "auto"})
            second = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "auto"})
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(ProjectSnapshot.objects.filter(project_id=self.project_id).count(), 1)

    def test_manual_snapshot_not_deduplicated(self):
        with self._patch_collab():
            first = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
            second = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        self.assertNotEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(ProjectSnapshot.objects.filter(project_id=self.project_id).count(), 2)


class ListSnapshotsTests(SnapshotTestsBase):
    def test_lists_newest_first(self):
        with self._patch_collab():
            post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual", "label": "one"})
            post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual", "label": "two"})
        response = self.owner.get(f"/api/projects/{self.project_id}/snapshots")
        self.assertEqual(response.status_code, 200)
        labels = [s["label"] for s in response.json()]
        self.assertEqual(labels, ["two", "one"])

    def test_stranger_without_access_gets_404(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = stranger.get(f"/api/projects/{self.project_id}/snapshots")
        self.assertEqual(response.status_code, 404)


class SnapshotFileContentTests(SnapshotTestsBase):
    def test_reads_file_content_at_snapshot_time(self):
        with self._patch_collab():
            snap = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        snapshot_id = snap.json()["id"]
        response = self.owner.get(
            f"/api/projects/{self.project_id}/snapshots/{snapshot_id}/file-content", {"path": "main.tex"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("documentclass", response.json()["content"])

    def test_missing_path_is_404(self):
        with self._patch_collab():
            snap = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        snapshot_id = snap.json()["id"]
        response = self.owner.get(
            f"/api/projects/{self.project_id}/snapshots/{snapshot_id}/file-content", {"path": "nope.tex"}
        )
        self.assertEqual(response.status_code, 404)

    def test_unknown_snapshot_is_404(self):
        response = self.owner.get(
            f"/api/projects/{self.project_id}/snapshots/00000000-0000-0000-0000-000000000000/file-content",
            {"path": "main.tex"},
        )
        self.assertEqual(response.status_code, 404)


class RestoreSnapshotTests(SnapshotTestsBase):
    def _main_tex_file(self):
        return ProjectFile.objects.get(project_id=self.project_id, path="main.tex")

    def test_restore_reverts_edited_content_and_takes_safety_snapshot(self):
        with self._patch_collab():
            original = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        original_id = original.json()["id"]

        f = self._main_tex_file()
        from core import storage

        storage.put_object(f.storage_key, b"EDITED CONTENT", "text/plain; charset=utf-8")
        f.size = len(b"EDITED CONTENT")
        f.save(update_fields=["size"])

        with self._patch_collab(), patch("projects.versions_api._replace_collab_content", return_value=True) as mock_replace:
            response = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots/{original_id}/restore")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["restored_to"]["id"], original_id)
        self.assertIsNotNone(body["safety_snapshot"])
        mock_replace.assert_called()
        restored_content = mock_replace.call_args.args[1]
        self.assertIn("documentclass", restored_content)

        # 2 total: the original manual one + the pre-restore safety auto-snapshot.
        self.assertEqual(ProjectSnapshot.objects.filter(project_id=self.project_id).count(), 2)

    def test_restore_recreates_a_deleted_file(self):
        with self._patch_collab():
            original = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        original_id = original.json()["id"]

        self._main_tex_file().delete()
        self.assertFalse(ProjectFile.objects.filter(project_id=self.project_id, path="main.tex").exists())

        with self._patch_collab(), patch("projects.versions_api._replace_collab_content", return_value=True):
            response = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots/{original_id}/restore")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(ProjectFile.objects.filter(project_id=self.project_id, path="main.tex").exists())

    def test_restore_deletes_a_file_added_after_the_snapshot(self):
        with self._patch_collab():
            original = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        original_id = original.json()["id"]

        post_json(self.owner, f"/api/projects/{self.project_id}/files", {"path": "extra.tex", "content": "hi"})
        self.assertTrue(ProjectFile.objects.filter(project_id=self.project_id, path="extra.tex").exists())

        with self._patch_collab(), patch("projects.versions_api._replace_collab_content", return_value=True):
            response = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots/{original_id}/restore")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(ProjectFile.objects.filter(project_id=self.project_id, path="extra.tex").exists())

    def test_collab_unreachable_falls_back_to_direct_storage_write(self):
        with self._patch_collab():
            original = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        original_id = original.json()["id"]

        f = self._main_tex_file()
        from core import storage

        storage.put_object(f.storage_key, b"EDITED", "text/plain; charset=utf-8")

        with self._patch_collab(), patch("projects.versions_api._replace_collab_content", return_value=False):
            response = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots/{original_id}/restore")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"documentclass", storage.get_object(self._main_tex_file().storage_key))

    def test_viewer_cannot_restore(self):
        with self._patch_collab():
            original = post_json(self.owner, f"/api/projects/{self.project_id}/snapshots", {"kind": "manual"})
        original_id = original.json()["id"]

        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        with self._patch_collab():
            response = post_json(viewer, f"/api/projects/{self.project_id}/snapshots/{original_id}/restore")
        self.assertEqual(response.status_code, 403)

    def test_unknown_snapshot_restore_is_404(self):
        with self._patch_collab():
            response = post_json(
                self.owner,
                f"/api/projects/{self.project_id}/snapshots/00000000-0000-0000-0000-000000000000/restore",
            )
        self.assertEqual(response.status_code, 404)
