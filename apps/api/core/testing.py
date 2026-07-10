from django.core.cache import cache
from django.test import TestCase


class ApiTestCase(TestCase):
    """Base TestCase that clears the process-local rate-limit cache before
    each test. LocMemCache isn't reset between tests by Django's test
    runner (unlike the DB, which rolls back per test), so without this,
    rate-limited endpoints (core.ratelimit) leak call counts across tests
    and cause order-dependent failures."""

    def setUp(self):
        super().setUp()
        cache.clear()
