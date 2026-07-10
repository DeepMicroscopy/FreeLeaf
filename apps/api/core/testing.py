from django.core.cache import cache
from django.test import TestCase

from core.session import SESSION_USER_KEY


class ApiTestCase(TestCase):
    """Base TestCase that clears the process-local rate-limit cache before
    each test. LocMemCache isn't reset between tests by Django's test
    runner (unlike the DB, which rolls back per test), so without this,
    rate-limited endpoints (core.ratelimit) leak call counts across tests
    and cause order-dependent failures."""

    def setUp(self):
        super().setUp()
        cache.clear()


def login_as(client, user) -> None:
    """Log a Django test Client in as `user` directly, bypassing the auth
    endpoints entirely. Used for test setup that just needs *a* logged-in
    non-anonymous user and doesn't care how — going through magic-link for
    this got more expensive once it required a real ShareLink token (it
    only works in the accept-an-invite context now), and going through
    ORCID for every such test would mean mocking exchange_code everywhere
    a logged-in user is merely a precondition, not the thing under test."""
    session = client.session
    session[SESSION_USER_KEY] = str(user.id)
    session.save()
