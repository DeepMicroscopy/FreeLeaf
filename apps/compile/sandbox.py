"""Sandboxed pdflatex/xelatex job execution (Plan.md §7).

Each call to run_job() spawns one ephemeral, isolated container from the
freeleaf-texlive image (built from docker/texlive/) via the Docker Engine
API, enforcing every rule in §7:

  1. No shell-escape        -> -no-shell-escape baked into the engine
                                command itself (not relying on latexmk's
                                defaults or texmf.cnf), verified against
                                latexmk's actual docs (no native
                                -no-shell-escape flag exists on latexmk
                                itself; must override $pdflatex/$xelatex).
  2. No network              -> network_disabled=True
  3. Ephemeral & isolated    -> fresh container per job, removed after;
                                only the job's own tmpdir is mounted
  4. Resource limits         -> mem_limit, nano_cpus, pids_limit, wall-clock
                                timeout enforced by us (container killed on
                                expiry, not just the client-side wait)
  5. Non-root                -> image runs as texuser (uid 1000); user=
                                also set explicitly here as defense in depth
  6. Dropped capabilities    -> cap_drop=["ALL"], no privileged mode
  7. Sanitized paths         -> caller (apps/api) already validates paths at
                                file-creation time; this module additionally
                                refuses to extract any tar member that
                                isn't a plain, relative, non-traversing path
  8. Compiler selection      -> engine picked by the caller, passed straight
                                through to the fixed command template below
  9. Structured output       -> see CompileResult
"""

import io
import os
import shutil
import tarfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import docker
from docker.errors import APIError, NotFound

IMAGE = "freeleaf-texlive:latest"
WALL_CLOCK_TIMEOUT_SECONDS = 60
MEM_LIMIT = "1g"
NANO_CPUS = 1_000_000_000  # 1 CPU
PIDS_LIMIT = 100
MAX_OUTPUT_BYTES = 50 * 1024 * 1024  # 50 MB cap on anything we read back

# apps/compile talks to the *host's* Docker daemon over the mounted socket
# (see docs/decisions/compile-sandbox.md) to spawn sibling job containers.
# That daemon resolves bind-mount sources against the host filesystem, not
# this container's own — a plain tempfile.mkdtemp() here creates a path
# that's invisible to the host, so the sibling container's mount silently
# gets an empty directory instead of the job's files (found by testing: the
# job container reported "Could not find file 'main.tex'" despite it very
# much being written on this side). Fix: docker-compose.yml bind-mounts one
# real host directory into this container at CONTAINER_JOBS_DIR; we write
# job files there (visible on both sides), but when telling the *host*
# daemon what to bind-mount into the sibling, we give it the matching
# HOST_JOBS_DIR path instead.
CONTAINER_JOBS_DIR = Path(os.environ.get("COMPILE_JOBS_CONTAINER_DIR", "/var/lib/freeleaf/jobs"))
HOST_JOBS_DIR = os.environ.get("COMPILE_JOBS_HOST_DIR")

ENGINE_COMMANDS = {
    # Deliberately no -halt-on-error: that stops the engine at the very
    # first error, which for pdfTeX-family engines means no PDF gets
    # written at all — even when the document has just one recoverable
    # issue (an undefined \ref, a missing optional package) and would
    # otherwise compile to a perfectly usable PDF. -interaction=nonstopmode
    # alone already guarantees the batch run never blocks waiting for
    # input (the actual requirement in this non-interactive sandbox); it
    # additionally makes the engine skip past an error and keep going to
    # the end of the document instead of aborting.
    "pdflatex": (
        "pdflatex -synctex=1 -no-shell-escape -interaction=nonstopmode %O %S"
    ),
    "xelatex": (
        "xelatex -synctex=1 -no-shell-escape -interaction=nonstopmode %O %S"
    ),
}


class CompileError(Exception):
    pass


class UnsafeArchiveError(CompileError):
    pass


@dataclass
class CompileResult:
    status: str  # "success" | "failed" | "timeout"
    log: str
    pdf: bytes | None
    synctex: bytes | None
    duration_ms: int
    exit_code: int | None
    compiler: str


def _safe_extract(tar_bytes: bytes, dest: Path) -> None:
    """Extract a tar archive, refusing any entry that could escape `dest`.

    Python's tarfile.extractall() is a known path-traversal vector when the
    archive is untrusted (CVE-2007-4559 and friends): a member named e.g.
    "../../etc/passwd" or an absolute path, or a symlink pointing outside
    the extraction root, writes outside `dest` unless the caller checks
    every member first. All of our project file paths are already validated
    at creation time (projects/paths.py), but this is the boundary where
    untrusted-by-construction bytes become filesystem writes, so it gets
    its own independent check.
    """
    dest = dest.resolve()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*") as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise UnsafeArchiveError(f"refusing symlink/hardlink in archive: {member.name}")
            member_path = (dest / member.name).resolve()
            if member_path != dest and dest not in member_path.parents:
                raise UnsafeArchiveError(f"refusing path escaping job dir: {member.name}")
            if not member.isfile() and not member.isdir():
                raise UnsafeArchiveError(f"refusing non-regular file in archive: {member.name}")
        tar.extractall(dest)  # noqa: S202 - membership already validated above


def run_job(tar_bytes: bytes, compiler: str, main_file: str) -> CompileResult:
    if compiler not in ENGINE_COMMANDS:
        raise CompileError(f"unsupported compiler: {compiler}")

    job_id = uuid.uuid4().hex
    job_dir = CONTAINER_JOBS_DIR / job_id
    src_dir = job_dir / "src"
    out_dir = job_dir / "out"
    src_dir.mkdir(parents=True)
    out_dir.mkdir(parents=True)
    # Sandbox containers run as uid 1000 (texuser); the bind-mounted dirs
    # must be writable by that uid regardless of the host user running us.
    src_dir.chmod(0o777)
    out_dir.chmod(0o777)

    # Path the *host* daemon can actually bind-mount for the sibling
    # container — see the CONTAINER_JOBS_DIR/HOST_JOBS_DIR note above.
    host_job_dir = f"{HOST_JOBS_DIR}/{job_id}" if HOST_JOBS_DIR else str(job_dir)

    try:
        _safe_extract(tar_bytes, src_dir)
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

    engine_cmd = ENGINE_COMMANDS[compiler]
    var_name = compiler  # $pdflatex or $xelatex
    mode_flag = "-pdf" if compiler == "pdflatex" else "-xelatex"
    command = [
        "latexmk",
        mode_flag,
        "-interaction=nonstopmode",
        # -f: "force continued processing past errors" (verified via
        # `latexmk --help` against the actual installed binary) — keeps
        # latexmk running its full recipe (further passes, bibtex/biber)
        # even if an earlier pass reported errors, mirroring the same
        # "push through to a usable PDF" choice made in ENGINE_COMMANDS.
        "-f",
        "-outdir=/work/out",
        "-e",
        f"${var_name}=q/{engine_cmd}/",
        main_file,
    ]

    client = docker.from_env()
    container_name = f"freeleaf-compile-job-{job_id}"
    started = time.monotonic()
    container = None
    try:
        container = client.containers.run(
            IMAGE,
            command=command,
            name=container_name,
            working_dir="/work/src",
            volumes={
                f"{host_job_dir}/src": {"bind": "/work/src", "mode": "ro"},
                f"{host_job_dir}/out": {"bind": "/work/out", "mode": "rw"},
            },
            network_disabled=True,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges"],
            pids_limit=PIDS_LIMIT,
            mem_limit=MEM_LIMIT,
            nano_cpus=NANO_CPUS,
            read_only=True,
            tmpfs={"/tmp": "rw,noexec,nosuid,size=64m"},
            user="1000:1000",
            detach=True,
        )

        try:
            wait_result = container.wait(timeout=WALL_CLOCK_TIMEOUT_SECONDS)
            exit_code = wait_result.get("StatusCode")
            # Provisional — with -halt-on-error/-f removed above, latexmk
            # commonly exits nonzero even when it *did* push through
            # recoverable errors and produce a perfectly usable PDF (e.g. an
            # undefined \ref). The exit code alone is no longer a reliable
            # signal; whether a PDF actually landed (checked below) is.
            status = "success"
        except Exception:
            status = "timeout"
            exit_code = None
            try:
                container.kill()
            except (APIError, NotFound):
                pass

        duration_ms = int((time.monotonic() - started) * 1000)

        try:
            log_bytes = container.logs(stdout=True, stderr=True)
        except (APIError, NotFound):
            log_bytes = b""
        log = log_bytes[:MAX_OUTPUT_BYTES].decode("utf-8", errors="replace")

        pdf_bytes = _read_capped(out_dir / (Path(main_file).stem + ".pdf"))
        synctex_bytes = _read_capped(out_dir / (Path(main_file).stem + ".synctex.gz"))

        if status == "success" and pdf_bytes is None:
            status = "failed"  # no PDF actually landed — genuinely nothing to show

        return CompileResult(
            status=status,
            log=log,
            pdf=pdf_bytes,
            synctex=synctex_bytes,
            duration_ms=duration_ms,
            exit_code=exit_code,
            compiler=compiler,
        )
    finally:
        if container is not None:
            try:
                container.remove(force=True)
            except (APIError, NotFound):
                pass
        shutil.rmtree(job_dir, ignore_errors=True)


def _read_capped(path: Path) -> bytes | None:
    if not path.exists():
        return None
    if path.stat().st_size > MAX_OUTPUT_BYTES:
        return None
    return path.read_bytes()
