import json

from django.test import Client

from core.testing import ApiTestCase, login_as

from .models import User


def post_json(client, url, data=None):
    return client.post(url, data=json.dumps(data or {}), content_type="application/json")


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
