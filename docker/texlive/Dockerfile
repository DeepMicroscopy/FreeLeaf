# Ephemeral sandbox worker image (Plan.md §7). Spawned per compile job by
# apps/compile via the Docker Engine API — never runs long-lived, never
# exposes a port, never has network access at runtime (--network none is
# set by the caller). This image itself just needs pdflatex + xelatex +
# latexmk + enough fonts/packages for common documents.
#
# texlive-full is ~5-7GB and unnecessary; this subset covers the common
# case (article/report/book classes, standard packages, xelatex+fontspec).
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-xetex \
    texlive-bibtex-extra \
    biber \
    latexmk \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 texuser
USER texuser
WORKDIR /work/src
