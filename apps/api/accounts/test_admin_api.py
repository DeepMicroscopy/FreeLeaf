import json

from django.test import Client

from core.testing import ApiTestCase, login_as
from projects.models import Project

from .models import User


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


def patch_json(client, url, data=None):
    return client.patch(url, data=json.dumps(data or {}), content_type="application/json")


class AdminUsersTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        admin_user = User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        login_as(self.admin, admin_user)

        self.regular = Client()
        login_as(self.regular, User.objects.create(kind=User.Kind.EMAIL, email="regular@example.com"))

    def test_non_admin_gets_403(self):
        response = self.regular.get("/api/admin/users")
        self.assertEqual(response.status_code, 403)

    def test_requires_login(self):
        response = Client().get("/api/admin/users")
        self.assertEqual(response.status_code, 401)

    def test_admin_sees_project_counts(self):
        post_json(self.regular, "/api/projects", {"name": "P1"})
        post_json(self.regular, "/api/projects", {"name": "P2"})

        response = self.admin.get("/api/admin/users")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 2)
        regular_entry = next(u for u in body if u["email"] == "regular@example.com")
        self.assertEqual(regular_entry["project_count"], 2)
        admin_entry = next(u for u in body if u["email"] == "admin@example.com")
        self.assertEqual(admin_entry["project_count"], 0)
        self.assertTrue(admin_entry["is_admin"])


class UpdateUserAdminTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        self.admin_user = User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        login_as(self.admin, self.admin_user)

        self.regular = Client()
        self.regular_user = User.objects.create(kind=User.Kind.EMAIL, email="regular@example.com")
        login_as(self.regular, self.regular_user)

    def test_non_admin_gets_403(self):
        response = patch_json(self.regular, f"/api/admin/users/{self.admin_user.id}", {"is_admin": False})
        self.assertEqual(response.status_code, 403)

    def test_promote_a_user_to_admin(self):
        response = patch_json(self.admin, f"/api/admin/users/{self.regular_user.id}", {"is_admin": True})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_admin"])
        self.regular_user.refresh_from_db()
        self.assertTrue(self.regular_user.is_admin)

    def test_demote_an_admin_when_another_admin_still_exists(self):
        second_admin = User.objects.create(kind=User.Kind.EMAIL, email="second@example.com", is_admin=True)
        response = patch_json(self.admin, f"/api/admin/users/{second_admin.id}", {"is_admin": False})
        self.assertEqual(response.status_code, 200)
        second_admin.refresh_from_db()
        self.assertFalse(second_admin.is_admin)

    def test_cannot_demote_the_last_admin(self):
        response = patch_json(self.admin, f"/api/admin/users/{self.admin_user.id}", {"is_admin": False})
        self.assertEqual(response.status_code, 400)
        self.admin_user.refresh_from_db()
        self.assertTrue(self.admin_user.is_admin)

    def test_404_for_unknown_user(self):
        response = patch_json(self.admin, "/api/admin/users/00000000-0000-0000-0000-000000000000", {"is_admin": True})
        self.assertEqual(response.status_code, 404)


class DeleteUserTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = Client()
        self.admin_user = User.objects.create(kind=User.Kind.EMAIL, email="admin@example.com", is_admin=True)
        login_as(self.admin, self.admin_user)

        self.regular = Client()
        self.regular_user = User.objects.create(kind=User.Kind.EMAIL, email="regular@example.com")
        login_as(self.regular, self.regular_user)

    def test_non_admin_gets_403(self):
        response = self.regular.delete(f"/api/admin/users/{self.regular_user.id}")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_delete_a_regular_user(self):
        response = self.admin.delete(f"/api/admin/users/{self.regular_user.id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(id=self.regular_user.id).exists())

    def test_cannot_delete_the_last_admin(self):
        response = self.admin.delete(f"/api/admin/users/{self.admin_user.id}")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(id=self.admin_user.id).exists())

    def test_can_delete_an_admin_if_another_admin_remains(self):
        second_admin = User.objects.create(kind=User.Kind.EMAIL, email="second@example.com", is_admin=True)
        response = self.admin.delete(f"/api/admin/users/{second_admin.id}")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(id=second_admin.id).exists())

    def test_deleting_a_user_nulls_out_owned_projects_instead_of_deleting_them(self):
        project = Project.objects.create(owner=self.regular_user, name="Keep me")
        response = self.admin.delete(f"/api/admin/users/{self.regular_user.id}")
        self.assertEqual(response.status_code, 200)
        project.refresh_from_db()
        self.assertIsNone(project.owner_id)

    def test_404_for_unknown_user(self):
        response = self.admin.delete("/api/admin/users/00000000-0000-0000-0000-000000000000")
        self.assertEqual(response.status_code, 404)
