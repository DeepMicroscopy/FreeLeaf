# Stage 1: generate copies of metric-compatible open-source fonts with their
# own internal name-table records rewritten to the proprietary Microsoft
# Office font name they stand in for (Arial, Times New Roman, Courier New,
# Calibri, Cambria) — texlive-full can never include those fonts themselves,
# since Microsoft doesn't license them for redistribution, and this is not a
# TeX package gap. See rename_fonts.py's own docstring for why a fontconfig
# `<alias>`/`<match>` layered on top of the *unrenamed* fonts wasn't enough:
# it worked for `fc-match`/`fc-list`, but XeTeX's own internal font manager
# still failed to find them, so the font files' own metadata has to say
# "Arial" directly. Kept as its own stage so the final image doesn't need
# fonttools (and its fairly heavy scipy/pythran dependency chain) at all —
# only the generated .ttf files are copied over.
FROM debian:bookworm-slim AS fontgen
RUN apt-get -o Acquire::Retries=8 -o Acquire::http::Timeout=60 -o Acquire::https::Timeout=60 update \
    && apt-get install -y --no-install-recommends \
       -o Acquire::Retries=8 \
       -o Acquire::http::Timeout=60 \
       -o Acquire::https::Timeout=60 \
    fonts-croscore fonts-crosextra-carlito fonts-crosextra-caladea python3-fonttools \
    && rm -rf /var/lib/apt/lists/*
COPY rename_fonts.py /tmp/rename_fonts.py
RUN python3 /tmp/rename_fonts.py

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

COPY --from=fontgen /usr/local/share/fonts/aliased /usr/local/share/fonts/aliased
RUN fc-cache -r

RUN useradd --create-home --uid 1000 texuser
USER texuser
WORKDIR /work/src
