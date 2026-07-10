"""Minimal fixed-window rate limiting on top of Django's cache framework.

Backed by the default LocMemCache, so limits are per-process — fine for the
single `runserver`/single-gunicorn-worker dev setup this project currently
runs. A multi-worker production deployment would need a shared cache
backend (e.g. Redis) for this to hold across workers.
"""

from django.core.cache import cache
from ninja.errors import HttpError


def check_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """Raise HttpError(429) if `key` has been hit more than `limit` times
    within the trailing `window_seconds`."""
    cache_key = f"ratelimit:{key}"
    if cache.add(cache_key, 1, timeout=window_seconds):
        count = 1
    else:
        try:
            count = cache.incr(cache_key)
        except ValueError:
            cache.set(cache_key, 1, timeout=window_seconds)
            count = 1
    if count > limit:
        raise HttpError(429, "Too many requests, try again later.")


def client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")
