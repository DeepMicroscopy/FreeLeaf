FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Just the `synctex` CLI (Plan.md §9 Phase 7 click-to-source) — texlive-binaries
# is the compiled-tools package (small), not the full TeX Live macro/font
# distribution the per-job sandbox image installs. This container never runs
# arbitrary user LaTeX itself, so this doesn't touch the sandbox's own
# lockdown (docker/texlive/Dockerfile, sandbox.py) at all.
RUN apt-get update && apt-get install -y --no-install-recommends texlive-binaries \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py sandbox.py synctex_query.py ./

# Runs as root — deliberate, scoped exception to the non-root convention
# used everywhere else in this project. This service's entire job is
# talking to the mounted Docker socket to spawn the *actually* sandboxed
# per-job containers (see sandbox.py); the socket's host-side group
# ownership varies across hosts, so matching it from a non-root user is
# fragile, and this container never runs user-supplied code itself — the
# ephemeral freeleaf-texlive containers it spawns do, under the full
# lockdown in sandbox.py. See docs/decisions/compile-sandbox.md.
EXPOSE 8100

CMD ["python", "main.py"]
