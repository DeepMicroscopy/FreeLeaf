# ADR: MinIO image source — third-party mirror, not the official registries

**Status:** accepted

## Decision

Pin MinIO (`docker-compose.yml`, `docker-compose.prod.yml`, `.github/workflows/ci.yml`) to `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` — a community-maintained rebuild of the exact final upstream MinIO Community Edition release — instead of the official `minio/minio` or `quay.io/minio/minio` images.

## Rationale

MinIO deleted its Docker Hub repositories on 2025-09-11 (Community Edition went source-only; the repo later entered maintenance mode and was archived); `quay.io/minio/minio` started requiring authentication for anonymous pulls shortly after. Neither official image is pullable anymore — confirmed directly (`docker pull minio/minio:latest` / `quay.io/minio/minio:latest` both fail even locally, not just in CI). This broke `docker compose up` for anyone without the image already cached, and broke CI's own `docker run minio/minio` step outright (`pull access denied`). The mirror is a straight rebuild of the same binary with identical CLI/env conventions (`server /data`, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `/minio/health/live`), verified directly against this project's exact `docker run` invocation before adopting it — no config changes needed beyond the image reference.

## Consequences

- Supply-chain trust now includes a third-party individual/small-org mirror, not just MinIO Inc. Pinned to an exact dated release tag (not `:latest`) specifically to avoid silently picking up a future, unreviewed image from that mirror.
- If this mirror disappears too, the fallback is building MinIO from source (now the only route MinIO Inc. itself supports) or switching to a different storage backend — revisit this ADR if that happens.
- Bump the pinned tag by hand if a newer verified mirror build is needed; don't switch to `:latest`.
