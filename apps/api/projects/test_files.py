import json

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client

from core.testing import ApiTestCase

from .models import ProjectFile


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def put_json(client, url, data=None):
    return client.put(url, data=json.dumps(data or {}), content_type="application/json")


def _login_via_magic_link(client, email):
    post_json(client, "/api/auth/magic-link/request", {"email": email})
    token = mail.outbox[-1].body.split("token=")[1].split()[0].strip()
    post_json(client, "/api/auth/magic-link/verify", {"token": token})


class FileTreeTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_via_magic_link(self.owner, "owner@example.com")
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
