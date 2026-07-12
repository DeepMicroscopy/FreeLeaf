# Ephemeral sandbox worker image (Plan.md §7). Spawned per compile job by
# apps/compile via the Docker Engine API — never runs long-lived, never
# exposes a port, never has network access at runtime (--network none is
# set by the caller).
#
# The full texlive-full metapackage (~5-7GB) is installed deliberately,
# not a curated subset — a curated package list (texlive-latex-extra etc.)
# kept surfacing "missing package" compile failures for documents using
# less-common classes/styles (e.g. specific biblatex citation styles), and
# there's no sandbox-security reason to trim it: every package here is just
# inert macro/font data read by pdflatex/xelatex inside the same locked-down,
# network-disabled, non-root container either way.
FROM debian:bookworm-slim

RUN apt-get -o Acquire::Retries=8 -o Acquire::http::Timeout=60 -o Acquire::https::Timeout=60 update \
    && apt-get install -y --no-install-recommends \
       -o Acquire::Retries=8 \
       -o Acquire::http::Timeout=60 \
       -o Acquire::https::Timeout=60 \
    texlive-full \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 texuser
USER texuser
WORKDIR /work/src
