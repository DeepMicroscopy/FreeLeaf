import json

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.test.client import BOUNDARY, MULTIPART_CONTENT, encode_multipart

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Project, ProjectFile


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def put_json(client, url, data=None):
    return client.put(url, data=json.dumps(data or {}), content_type="application/json")


def put_file(client, url, filename, content, content_type="application/octet-stream"):
    data = encode_multipart(BOUNDARY, {"file": SimpleUploadedFile(filename, content, content_type=content_type)})
    return client.put(url, data=data, content_type=MULTIPART_CONTENT)


def _login_new_user(client, email):
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)


class FileTreeTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Paper"})
        self.project_id = create.json()["id"]

    def test_project_creation_seeds_main_tex(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/files")
        self.assertEqual(response.status_code, 200)
        files = response.json()
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0]["path"], "main.tex")
        self.assertEqual(files[0]["type"], "tex")
        self.assertGreater(files[0]["size"], 0)

        content = self.owner.get(f"/api/projects/{self.project_id}/files/{files[0]['id']}/content")
        self.assertEqual(content.status_code, 200)
        self.assertIn(b"\\documentclass", content.content)

    def test_create_edit_and_persist_text_file(self):
        create = post_json(
            self.owner, f"/api/projects/{self.project_id}/files",
            {"path": "notes.tex", "content": "hello"},
        )
        self.assertEqual(create.status_code, 200)
        file_id = create.json()["id"]

        update = put_json(
            self.owner, f"/api/projects/{self.project_id}/files/{file_id}/content",
            {"content": "hello world"},
        )
        self.assertEqual(update.status_code, 200)
        self.assertEqual(update.json()["size"], len(b"hello world"))

        content = self.owner.get(f"/api/projects/{self.project_id}/files/{file_id}/content")
        self.assertEqual(content.content, b"hello world")

    def test_duplicate_path_is_rejected(self):
        response = post_json(
            self.owner, f"/api/projects/{self.project_id}/files", {"path": "main.tex"}
        )
        self.assertEqual(response.status_code, 409)

    def test_path_traversal_is_rejected(self):
        for bad_path in ["../evil.tex", "/etc/passwd", "a/../../b.tex", ""]:
            response = post_json(
                self.owner, f"/api/projects/{self.project_id}/files", {"path": bad_path}
            )
            self.assertEqual(response.status_code, 400, bad_path)

    def test_create_and_rename_folder_moves_descendants(self):
        folder = post_json(self.owner, f"/api/projects/{self.project_id}/folders", {"path": "figures"})
        self.assertEqual(folder.status_code, 200)

        child = post_json(
            self.owner, f"/api/projects/{self.project_id}/files",
            {"path": "figures/plot.tex", "content": "x"},
        )
        self.assertEqual(child.status_code, 200)

        rename = patch_json(
            self.owner, f"/api/projects/{self.project_id}/files/{folder.json()['id']}",
            {"path": "assets"},
        )
        self.assertEqual(rename.status_code, 200)

        files = {f["path"] for f in self.owner.get(f"/api/projects/{self.project_id}/files").json()}
        self.assertIn("assets", files)
        self.assertIn("assets/plot.tex", files)
        self.assertNotIn("figures/plot.tex", files)

    def test_delete_folder_cascades(self):
        post_json(self.owner, f"/api/projects/{self.project_id}/folders", {"path": "figures"})
        child = post_json(
            self.owner, f"/api/projects/{self.project_id}/files",
            {"path": "figures/plot.tex", "content": "x"},
        )
        folder_id = self.owner.get(f"/api/projects/{self.project_id}/files").json()
        folder_row = next(f for f in folder_id if f["path"] == "figures")

        delete = self.owner.delete(f"/api/projects/{self.project_id}/files/{folder_row['id']}")
        self.assertEqual(delete.status_code, 200)

        remaining = {f["path"] for f in self.owner.get(f"/api/projects/{self.project_id}/files").json()}
        self.assertNotIn("figures", remaining)
        self.assertNotIn("figures/plot.tex", remaining)
        self.assertFalse(ProjectFile.objects.filter(id=child.json()["id"]).exists())

    def test_upload_image_appears_in_tree(self):
        png_bytes = b"\x89PNG\r\n\x1a\nfake-but-fine-for-a-test"
        upload = self.owner.post(
            f"/api/projects/{self.project_id}/files/upload?path=figures/diagram.png",
            {"file": SimpleUploadedFile("diagram.png", png_bytes, content_type="image/png")},
        )
        self.assertEqual(upload.status_code, 200, upload.content)
        body = upload.json()
        self.assertEqual(body["type"], "image")
        self.assertEqual(body["size"], len(png_bytes))

        files = {f["path"]: f["type"] for f in self.owner.get(f"/api/projects/{self.project_id}/files").json()}
        self.assertEqual(files["figures/diagram.png"], "image")

        content = self.owner.get(f"/api/projects/{self.project_id}/files/{body['id']}/content")
        self.assertEqual(content.content, png_bytes)

    def test_viewer_cannot_write_files(self):
        link = post_json(
            self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})

        response = post_json(
            viewer, f"/api/projects/{self.project_id}/files", {"path": "hack.tex", "content": "x"}
        )
        self.assertEqual(response.status_code, 403)

    def test_stranger_cannot_list_files(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {})
        response = stranger.get(f"/api/projects/{self.project_id}/files")
        self.assertEqual(response.status_code, 404)


class BinaryContentReplaceTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Paper"})
        self.project_id = create.json()["id"]
        original = b"\x89PNG\r\n\x1a\noriginal-bytes-here"
        upload = self.owner.post(
            f"/api/projects/{self.project_id}/files/upload?path=diagram.png",
            {"file": SimpleUploadedFile("diagram.png", original, content_type="image/png")},
        )
        self.file_id = upload.json()["id"]
        self.original_size = len(original)

    def test_overwrite_updates_size_and_bytes_keeps_id_and_path(self):
        new_bytes = b"\x89PNG\r\n\x1a\nshorter"
        response = put_file(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/binary-content",
            "diagram.png", new_bytes, "image/png",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["id"], self.file_id)
        self.assertEqual(body["path"], "diagram.png")
        self.assertEqual(body["size"], len(new_bytes))
        self.assertNotEqual(len(new_bytes), self.original_size)

        content = self.owner.get(f"/api/projects/{self.project_id}/files/{self.file_id}/content")
        self.assertEqual(content.content, new_bytes)

    def test_rejects_folder(self):
        folder = post_json(self.owner, f"/api/projects/{self.project_id}/folders", {"path": "figures"})
        response = put_file(
            self.owner, f"/api/projects/{self.project_id}/files/{folder.json()['id']}/binary-content",
            "x.png", b"data", "image/png",
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_oversized_payload(self):
        from .files_api import MAX_UPLOAD_BYTES
        oversized = b"0" * (MAX_UPLOAD_BYTES + 1)
        response = put_file(
            self.owner, f"/api/projects/{self.project_id}/files/{self.file_id}/binary-content",
            "diagram.png", oversized, "image/png",
        )
        self.assertEqual(response.status_code, 413)

    def test_requires_owner_or_editor(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        response = put_file(
            viewer, f"/api/projects/{self.project_id}/files/{self.file_id}/binary-content",
            "diagram.png", b"hacked", "image/png",
        )
        self.assertEqual(response.status_code, 403)

    def test_404_for_foreign_project_file(self):
        other_owner = Client()
        _login_new_user(other_owner, "other@example.com")
        other_project = post_json(other_owner, "/api/projects", {"name": "Other"})
        response = put_file(
            other_owner, f"/api/projects/{other_project.json()['id']}/files/{self.file_id}/binary-content",
            "diagram.png", b"data", "image/png",
        )
        self.assertEqual(response.status_code, 404)


class ProjectActivityAttributionTests(ApiTestCase):
    """Creating a project has no attribution yet (last_edited_by_name is
    null); direct file edits by a collaborator should attribute the project
    to that collaborator, matching the "who last changed this" list column."""

    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Paper"})
        self.project_id = create.json()["id"]
        self.assertIsNone(create.json()["last_edited_by_name"])

    def test_editor_creating_a_file_attributes_the_project_to_them(self):
        editor = Client()
        _login_new_user(editor, "editor@example.com")
        from .models import Membership, Role

        Membership.objects.create(
            project_id=self.project_id, user=User.objects.get(email="editor@example.com"), role=Role.EDITOR
        )
        post_json(editor, f"/api/projects/{self.project_id}/files", {"path": "notes.tex", "content": "x"})
        response = self.owner.get(f"/api/projects/{self.project_id}")
        self.assertEqual(response.json()["last_edited_by_name"], "editor@example.com")

    def test_renaming_the_project_attributes_it_to_the_renamer(self):
        response = patch_json(self.owner, f"/api/projects/{self.project_id}", {"name": "New Name"})
        self.assertEqual(response.json()["last_edited_by_name"], "owner@example.com")

    def test_deleting_a_file_attributes_the_project(self):
        main_tex = ProjectFile.objects.get(project_id=self.project_id, path="main.tex")
        self.owner.delete(f"/api/projects/{self.project_id}/files/{main_tex.id}")
        response = self.owner.get(f"/api/projects/{self.project_id}")
        self.assertEqual(response.json()["last_edited_by_name"], "owner@example.com")
