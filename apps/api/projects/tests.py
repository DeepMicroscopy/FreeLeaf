import io
import json
import zipfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from django.utils import timezone

from accounts.models import User
from core.testing import ApiTestCase, login_as

from .models import Membership, Project, ProjectFile, ProjectSettings, Role, ShareLink


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


def _login_new_user(client, email):
    """Not via magic-link: that now requires an existing ShareLink token
    (see accounts/api.py), so it can't bootstrap the very first non-anonymous
    user in a test. A directly-created User + direct session login serves
    the same "just get me a logged-in owner" purpose these tests need."""
    user = User.objects.create(kind=User.Kind.EMAIL, email=email)
    login_as(client, user)


class ProjectCrudTests(ApiTestCase):
    def test_anonymous_user_cannot_create_project(self):
        post_json(self.client, "/api/auth/anonymous", {"display_name": "Guest"})
        response = post_json(self.client, "/api/projects", {"name": "My Paper"})
        self.assertEqual(response.status_code, 403)

    def test_logged_in_user_can_create_list_get_update_delete(self):
        _login_new_user(self.client, "ada@example.com")

        create = post_json(self.client, "/api/projects", {"name": "My Paper"})
        self.assertEqual(create.status_code, 200)
        project_id = create.json()["id"]
        self.assertEqual(create.json()["role"], "owner")

        listing = self.client.get("/api/projects")
        self.assertEqual(len(listing.json()), 1)

        detail = self.client.get(f"/api/projects/{project_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["name"], "My Paper")

        updated = patch_json(self.client, f"/api/projects/{project_id}", {"name": "Renamed"})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["name"], "Renamed")

        deleted = self.client.delete(f"/api/projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(Project.objects.filter(id=project_id).exists())

    def test_create_project_requires_login(self):
        response = post_json(Client(), "/api/projects", {"name": "Nope"})
        self.assertEqual(response.status_code, 401)


class ShareLinkAuthorizationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner_client = Client()
        _login_new_user(self.owner_client, "owner@example.com")
        create = post_json(self.owner_client, "/api/projects", {"name": "Shared Paper"})
        self.project_id = create.json()["id"]

    def test_stranger_without_share_link_is_blocked(self):
        stranger = Client()
        post_json(stranger, "/api/auth/anonymous", {"display_name": "Stranger"})
        response = stranger.get(f"/api/projects/{self.project_id}")
        self.assertEqual(response.status_code, 404)

    def test_anonymous_user_can_join_via_share_link_and_only_that_project(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "editor"}
        )
        self.assertEqual(link_resp.status_code, 200)
        token = link_resp.json()["token"]
        self.assertIsNotNone(token)

        joiner = Client()
        join = post_json(joiner, f"/api/share-links/{token}/join", {"display_name": "Anon Collaborator"})
        self.assertEqual(join.status_code, 200)
        self.assertEqual(join.json()["id"], self.project_id)
        self.assertEqual(join.json()["role"], "editor")

        me = joiner.get("/api/auth/me")
        self.assertEqual(me.json()["kind"], "anonymous")
        self.assertEqual(me.json()["display_name"], "Anon Collaborator")

        # Access granted to the shared project...
        detail = joiner.get(f"/api/projects/{self.project_id}")
        self.assertEqual(detail.status_code, 200)

        # ...but not to some other project this anonymous user has no link for.
        other = post_json(self.owner_client, "/api/projects", {"name": "Other Paper"})
        other_id = other.json()["id"]
        blocked = joiner.get(f"/api/projects/{other_id}")
        self.assertEqual(blocked.status_code, 404)

    def test_expired_share_link_is_rejected(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        token = link_resp.json()["token"]
        ShareLink.objects.filter(project_id=self.project_id).update(
            expires_at=timezone.now() - timedelta(hours=1)
        )
        response = post_json(Client(), f"/api/share-links/{token}/join", {})
        self.assertEqual(response.status_code, 404)

    def test_only_owner_can_create_or_list_share_links(self):
        member_client = Client()
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        post_json(member_client, f"/api/share-links/{link_resp.json()['token']}/join", {})

        forbidden = post_json(
            member_client, f"/api/projects/{self.project_id}/share-links", {"role": "editor"}
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_viewer_cannot_rename_project(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {})

        response = patch_json(viewer, f"/api/projects/{self.project_id}", {"name": "Hijacked"})
        self.assertEqual(response.status_code, 403)

    def test_revoked_share_link_no_longer_works(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        link_id = link_resp.json()["id"]
        token = link_resp.json()["token"]

        revoke = self.owner_client.delete(f"/api/projects/{self.project_id}/share-links/{link_id}")
        self.assertEqual(revoke.status_code, 200)

        response = post_json(Client(), f"/api/share-links/{token}/join", {})
        self.assertEqual(response.status_code, 404)


class MembersTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner_client = Client()
        _login_new_user(self.owner_client, "owner@example.com")
        create = post_json(self.owner_client, "/api/projects", {"name": "Shared Paper"})
        self.project_id = create.json()["id"]

    def test_owner_sees_all_members_and_roles(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {"display_name": "Vera Viewer"})

        response = self.owner_client.get(f"/api/projects/{self.project_id}/members")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 2)
        roles = {m["role"] for m in body}
        self.assertEqual(roles, {"owner", "viewer"})
        viewer_entry = next(m for m in body if m["role"] == "viewer")
        self.assertEqual(viewer_entry["display_name"], "Vera Viewer")
        self.assertFalse(viewer_entry["is_you"])
        owner_entry = next(m for m in body if m["role"] == "owner")
        self.assertTrue(owner_entry["is_you"])

    def test_viewer_cannot_list_members(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {})
        response = viewer.get(f"/api/projects/{self.project_id}/members")
        self.assertEqual(response.status_code, 403)

    def test_requires_login(self):
        response = Client().get(f"/api/projects/{self.project_id}/members")
        self.assertEqual(response.status_code, 401)

    def test_owner_can_promote_viewer_to_editor(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {"display_name": "Vera"})
        member_user_id = next(
            m["user_id"] for m in self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
            if m["display_name"] == "Vera"
        )

        response = patch_json(
            self.owner_client, f"/api/projects/{self.project_id}/members/{member_user_id}", {"role": "editor"}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role"], "editor")

    def test_cannot_demote_the_last_owner(self):
        owner_user_id = next(
            m["user_id"] for m in self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
            if m["role"] == "owner"
        )
        response = patch_json(
            self.owner_client, f"/api/projects/{self.project_id}/members/{owner_user_id}", {"role": "editor"}
        )
        self.assertEqual(response.status_code, 400)

    def test_owner_can_remove_a_member(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {"display_name": "Vera"})
        member_user_id = next(
            m["user_id"] for m in self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
            if m["display_name"] == "Vera"
        )

        response = self.owner_client.delete(f"/api/projects/{self.project_id}/members/{member_user_id}")
        self.assertEqual(response.status_code, 200)

        remaining = self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
        self.assertEqual(len(remaining), 1)

        removed_access = viewer.get(f"/api/projects/{self.project_id}")
        self.assertEqual(removed_access.status_code, 404)

    def test_cannot_remove_the_last_owner(self):
        owner_user_id = next(
            m["user_id"] for m in self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
            if m["role"] == "owner"
        )
        response = self.owner_client.delete(f"/api/projects/{self.project_id}/members/{owner_user_id}")
        self.assertEqual(response.status_code, 400)

    def test_viewer_cannot_change_roles(self):
        link_resp = post_json(
            self.owner_client, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"}
        )
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link_resp.json()['token']}/join", {})
        member_user_id = next(
            m["user_id"] for m in self.owner_client.get(f"/api/projects/{self.project_id}/members").json()
            if m["role"] == "owner"
        )
        response = patch_json(
            viewer, f"/api/projects/{self.project_id}/members/{member_user_id}", {"role": "viewer"}
        )
        self.assertEqual(response.status_code, 403)


def _make_zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries.items():
            zf.writestr(name, data)
    return buf.getvalue()


class ZipImportTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")

    def _import(self, client, name, zip_bytes):
        return client.post(
            f"/api/projects/import?name={name}",
            {"file": SimpleUploadedFile("upload.zip", zip_bytes, content_type="application/zip")},
        )

    def test_import_creates_project_and_files(self):
        zip_bytes = _make_zip({"main.tex": b"\\documentclass{article}", "refs.bib": b"@article{x,}"})
        response = self._import(self.owner, "Imported Paper", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["name"], "Imported Paper")
        self.assertEqual(body["role"], "owner")

        paths = set(ProjectFile.objects.filter(project_id=body["id"]).values_list("path", flat=True))
        self.assertEqual(paths, {"main.tex", "refs.bib"})

    def test_strips_common_leading_directory(self):
        zip_bytes = _make_zip({"MyProject/main.tex": b"x", "MyProject/sub/fig.png": b"y"})
        response = self._import(self.owner, "P", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        paths = set(ProjectFile.objects.filter(project_id=response.json()["id"]).values_list("path", flat=True))
        self.assertEqual(paths, {"main.tex", "sub/fig.png"})

    def test_skips_junk_and_traversal_entries_without_failing(self):
        zip_bytes = _make_zip(
            {
                "main.tex": b"x",
                "__MACOSX/._main.tex": b"junk",
                ".DS_Store": b"junk",
                "../../etc/passwd": b"evil",
            }
        )
        response = self._import(self.owner, "P", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        paths = set(ProjectFile.objects.filter(project_id=response.json()["id"]).values_list("path", flat=True))
        self.assertEqual(paths, {"main.tex"})

    def test_empty_zip_rejected(self):
        response = self._import(self.owner, "P", _make_zip({}))
        self.assertEqual(response.status_code, 400)

    def test_all_junk_zip_rejected(self):
        response = self._import(self.owner, "P", _make_zip({".DS_Store": b"junk"}))
        self.assertEqual(response.status_code, 400)

    def test_bad_zip_bytes_rejected(self):
        response = self.owner.post(
            "/api/projects/import?name=P",
            {"file": SimpleUploadedFile("upload.zip", b"not a zip", content_type="application/zip")},
        )
        self.assertEqual(response.status_code, 400)

    def test_requires_login(self):
        response = self._import(Client(), "P", _make_zip({"main.tex": b"x"}))
        self.assertEqual(response.status_code, 401)

    def test_anonymous_cannot_import(self):
        anon = Client()
        post_json(anon, "/api/auth/anonymous", {"display_name": "Guest"})
        response = self._import(anon, "P", _make_zip({"main.tex": b"x"}))
        self.assertEqual(response.status_code, 403)

    def test_blank_name_rejected(self):
        response = self._import(self.owner, "", _make_zip({"main.tex": b"x"}))
        self.assertEqual(response.status_code, 400)

    def test_traversal_entries_still_skipped_not_sanitized(self):
        zip_bytes = _make_zip({"main.tex": b"x", "../../etc/passwd": b"evil"})
        response = self._import(self.owner, "P", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        paths = set(ProjectFile.objects.filter(project_id=response.json()["id"]).values_list("path", flat=True))
        self.assertEqual(paths, {"main.tex"})

    def test_special_characters_sanitized_not_skipped(self):
        zip_bytes = _make_zip({
            "main.tex": b"x",
            "Pilot study: 'atypical' + examples.png": b"y",
        })
        response = self._import(self.owner, "P", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        paths = set(ProjectFile.objects.filter(project_id=response.json()["id"]).values_list("path", flat=True))
        self.assertEqual(paths, {"main.tex", "Pilot study_ _atypical_ _ examples.png"})

    def test_main_doc_detected_when_not_named_main_tex(self):
        zip_bytes = _make_zip({"proposal.tex": b"\\documentclass{article}", "refs.bib": b"@x"})
        response = self._import(self.owner, "P", zip_bytes)
        self.assertEqual(response.status_code, 200, response.content)
        settings_row = ProjectSettings.objects.get(project_id=response.json()["id"])
        self.assertEqual(settings_row.main_doc_path, "proposal.tex")

    def test_main_tex_preferred_over_other_tex_files(self):
        zip_bytes = _make_zip({"main.tex": b"\\documentclass{article}", "chapter1.tex": b"x"})
        response = self._import(self.owner, "P", zip_bytes)
        settings_row = ProjectSettings.objects.get(project_id=response.json()["id"])
        self.assertEqual(settings_row.main_doc_path, "main.tex")

    def test_documentclass_file_preferred_among_multiple_tex_files(self):
        zip_bytes = _make_zip({
            "paper.tex": b"\\documentclass{article}\\input{sections/intro}",
            "sections/intro.tex": b"Some text, not a full document.",
        })
        response = self._import(self.owner, "P", zip_bytes)
        settings_row = ProjectSettings.objects.get(project_id=response.json()["id"])
        self.assertEqual(settings_row.main_doc_path, "paper.tex")

    def test_ambiguous_multi_tex_falls_back_to_first_by_name(self):
        # Genuinely ambiguous (neither has \documentclass, no single obvious
        # entry point) — but main_doc_path must still point at a real file,
        # never the nonexistent "main.tex" model default, so compiling isn't
        # broken outright. Deterministic tiebreak: alphabetically first.
        zip_bytes = _make_zip({"b.tex": b"no documentclass here", "a.tex": b"nor here"})
        response = self._import(self.owner, "P", zip_bytes)
        settings_row = ProjectSettings.objects.get_or_create(project_id=response.json()["id"])[0]
        self.assertEqual(settings_row.main_doc_path, "a.tex")

    def test_ambiguous_multiple_documentclass_files_falls_back_to_first_by_name(self):
        zip_bytes = _make_zip({
            "paperB.tex": b"\\documentclass{article}",
            "paperA.tex": b"\\documentclass{article}",
            "notes.tex": b"no documentclass here",
        })
        response = self._import(self.owner, "P", zip_bytes)
        settings_row = ProjectSettings.objects.get_or_create(project_id=response.json()["id"])[0]
        self.assertEqual(settings_row.main_doc_path, "paperA.tex")


class ZipExportTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = Client()
        _login_new_user(self.owner, "owner@example.com")
        create = post_json(self.owner, "/api/projects", {"name": "Export Me: Weird/Name?"})
        self.project_id = create.json()["id"]
        post_json(self.owner, f"/api/projects/{self.project_id}/files", {"path": "refs.bib", "content": "@x"})

    def test_export_contains_all_files(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/export")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/zip")

        zf = zipfile.ZipFile(io.BytesIO(response.content))
        self.assertEqual(set(zf.namelist()), {"main.tex", "refs.bib"})
        self.assertEqual(zf.read("refs.bib"), b"@x")

    def test_filename_sanitized_in_content_disposition(self):
        response = self.owner.get(f"/api/projects/{self.project_id}/export")
        disposition = response["Content-Disposition"]
        self.assertNotIn("/", disposition)
        self.assertNotIn("?", disposition)
        self.assertIn("Export Me_ Weird_Name_.zip", disposition)

    def test_viewer_can_export(self):
        link = post_json(self.owner, f"/api/projects/{self.project_id}/share-links", {"role": "viewer"})
        viewer = Client()
        post_json(viewer, f"/api/share-links/{link.json()['token']}/join", {})
        response = viewer.get(f"/api/projects/{self.project_id}/export")
        self.assertEqual(response.status_code, 200)

    def test_stranger_gets_404(self):
        stranger = Client()
        _login_new_user(stranger, "stranger@example.com")
        response = stranger.get(f"/api/projects/{self.project_id}/export")
        self.assertEqual(response.status_code, 404)

    def test_requires_login(self):
        response = Client().get(f"/api/projects/{self.project_id}/export")
        self.assertEqual(response.status_code, 401)

    def test_roundtrips_through_import(self):
        exported = self.owner.get(f"/api/projects/{self.project_id}/export")
        reimport = self.owner.post(
            "/api/projects/import?name=Reimported",
            {"file": SimpleUploadedFile("p.zip", exported.content, content_type="application/zip")},
        )
        self.assertEqual(reimport.status_code, 200, reimport.content)
        paths = set(
            ProjectFile.objects.filter(project_id=reimport.json()["id"]).values_list("path", flat=True)
        )
        self.assertEqual(paths, {"main.tex", "refs.bib"})


class MembershipModelTests(ApiTestCase):
    def test_unique_membership_per_project_user(self):
        user = User.objects.create(kind=User.Kind.ANONYMOUS, display_name="X")
        project = Project.objects.create(name="P")
        Membership.objects.create(project=project, user=user, role=Role.VIEWER)
        with self.assertRaises(Exception):
            Membership.objects.create(project=project, user=user, role=Role.EDITOR)
