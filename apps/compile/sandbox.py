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
                                only the job's own tmpdir is mounted. The
                                container is ALWAYS fresh and isolated this
                                way, with no exception. The one deliberate,
                                bounded relaxation: when the caller passes a
                                session_id (one browser tab's repeated
                                compiles), the host-side src/out directory
                                persists across calls instead of being
                                wiped, so latexmk's own incremental rebuild
                                can actually help — size-capped and
                                idle-evicted (see SESSION_CACHE_MAX_BYTES /
                                sweep_idle_sessions below), and never
                                shared across sessions/projects/users. See
                                docs/decisions/session-compile-cache.md.
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
import re
import shutil
import tarfile
import threading
import time
import uuid
from collections.abc import Callable
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

# Session-scoped incremental compile cache (docs/decisions/session-compile-
# cache.md): one browser tab's repeated compiles of the same project reuse
# the previous compile's src+out directories instead of starting from an
# empty one each time, so latexmk's own (mtime-based) dependency tracking
# can actually skip reprocessing unchanged files. Every individual
# sandboxed container run is exactly as ephemeral/isolated as a one-shot
# job — only this host-side directory persists, bounded by the cap and
# sweep below so an abandoned or runaway session can't grow forever.
SESSIONS_DIR_NAME = "sessions"
SESSION_CACHE_MAX_BYTES = 300 * 1024 * 1024  # 300 MB
SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60
# A session id is client-minted (crypto.randomUUID()) and becomes a path
# component, so it gets the same treatment as any other untrusted path
# input in this file: a tight allowlist, not just "contains no slashes".
_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def _valid_session_id(session_id: str | None) -> str | None:
    if session_id and _SESSION_ID_RE.match(session_id):
        return session_id
    return None


def _dir_size_bytes(path: Path) -> int:
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def sweep_idle_sessions(idle_seconds: int = SESSION_IDLE_TIMEOUT_SECONDS) -> None:
    """Deletes any session cache directory untouched for `idle_seconds`.
    Called periodically from a background thread (main.py) — there's no
    other scheduler in this codebase, and this process is already
    long-lived. Safe to race against an in-flight compile for the same
    session: worst case that one compile just finds its directories
    missing and recreates them fresh (see run_job below), not an error."""
    sessions_dir = CONTAINER_JOBS_DIR / SESSIONS_DIR_NAME
    if not sessions_dir.is_dir():
        return
    now = time.time()
    for entry in sessions_dir.iterdir():
        try:
            if entry.is_dir() and now - entry.stat().st_mtime > idle_seconds:
                shutil.rmtree(entry, ignore_errors=True)
        except FileNotFoundError:
            pass  # swept by a concurrent call or the session itself finishing

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


# Live step labels for the compile-progress spinner, keyed off the same
# reliable engine-start banners apps/api's log_parser.py already trusts to
# find "the real final run" — not latexmk's own free-text status lines,
# whose exact wording isn't guaranteed. Verified against a real sandbox
# compile: pdfTeX/XeTeX/LuaTeX/BibTeX all print "This is <engine>," at
# start of line; Biber's own banner is different (leveled-logger format,
# `INFO - This is Biber 2.18`) and gets its own pattern.
_ENGINE_BANNER_RE = re.compile(rb"^This is (pdfTeX|XeTeX|LuaTeX|BibTeX),")
_BIBER_BANNER_RE = re.compile(rb"^INFO - This is Biber")


def _track_compile_steps(container, on_step: Callable[[str], None]) -> None:
    """Best-effort: tails the container's combined stdout/stderr as it runs
    (`container.logs(stream=True, follow=True)`) and calls `on_step(label)`
    each time a new engine run starts, numbering reruns of the same engine
    ("pdfTeX run 1", "pdfTeX run 2", ...). Runs in its own daemon thread
    alongside the caller's `container.wait()`; any failure here (container
    removed mid-stream, decode hiccup) is swallowed — the actual compile
    result never depends on this, only the progress spinner does."""
    counts: dict[str, int] = {}

    def label_for(engine: str) -> str:
        counts[engine] = counts.get(engine, 0) + 1
        return f"{engine} run {counts[engine]}" if engine != "Biber" and engine != "BibTeX" else engine

    buf = b""
    try:
        for chunk in container.logs(stream=True, follow=True):
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                m = _ENGINE_BANNER_RE.match(line)
                if m:
                    on_step(label_for(m.group(1).decode()))
                elif _BIBER_BANNER_RE.match(line):
                    on_step(label_for("Biber"))
    except Exception:
        pass


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


def _safe_extract(tar_bytes: bytes, dest: Path) -> set[str]:
    """Extract a tar archive, refusing any entry that could escape `dest`.
    Returns the set of (posix-style, dest-relative) regular-file member
    names actually extracted — used by the session-scoped cache (below) to
    prune files that no longer belong to the project.

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
    file_names: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:*") as tar:
        for member in tar.getmembers():
            if member.issym() or member.islnk():
                raise UnsafeArchiveError(f"refusing symlink/hardlink in archive: {member.name}")
            member_path = (dest / member.name).resolve()
            if member_path != dest and dest not in member_path.parents:
                raise UnsafeArchiveError(f"refusing path escaping job dir: {member.name}")
            if not member.isfile() and not member.isdir():
                raise UnsafeArchiveError(f"refusing non-regular file in archive: {member.name}")
            if member.isfile():
                file_names.add(member.name)
        tar.extractall(dest)  # noqa: S202 - membership already validated above
    return file_names


def _prune_missing(dest: Path, keep: set[str]) -> None:
    """Removes any regular file under `dest` not present in `keep` (posix-
    style, dest-relative paths, matching `_safe_extract`'s return value).
    Only used for the session-scoped cache's persistent src dir — a
    one-shot job always starts from an empty dir, where this is a no-op by
    construction. Without this, a file renamed or deleted in the project
    would linger in the cached src dir indefinitely (it's never deleted by
    `tar.extractall()`, which only adds/overwrites), potentially confusing
    the compile (e.g. a stale duplicate of a renamed figure)."""
    for path in dest.rglob("*"):
        if path.is_file() and path.relative_to(dest).as_posix() not in keep:
            path.unlink(missing_ok=True)


def run_job(
    tar_bytes: bytes,
    compiler: str,
    main_file: str,
    on_step: Callable[[str], None] | None = None,
    session_id: str | None = None,
) -> CompileResult:
    if compiler not in ENGINE_COMMANDS:
        raise CompileError(f"unsupported compiler: {compiler}")

    job_id = uuid.uuid4().hex  # always unique per call — container name/logging only
    session_id = _valid_session_id(session_id)
    is_session = session_id is not None
    # Unrecognized/invalid session_id quietly falls back to the one-shot
    # path below rather than erroring — the cache is a pure performance
    # hint, never load-bearing for whether a compile succeeds.
    job_rel = f"{SESSIONS_DIR_NAME}/{session_id}" if is_session else job_id
    job_dir = CONTAINER_JOBS_DIR / job_rel
    src_dir = job_dir / "src"
    out_dir = job_dir / "out"

    if is_session and job_dir.exists() and _dir_size_bytes(job_dir) > SESSION_CACHE_MAX_BYTES:
        # A runaway or malicious document bloating its own cached build
        # output across many compiles in one session — reset rather than
        # erroring, so this compile just runs cold instead of the cache
        # ever growing unbounded.
        shutil.rmtree(job_dir, ignore_errors=True)

    src_dir.mkdir(parents=True, exist_ok=is_session)
    out_dir.mkdir(parents=True, exist_ok=is_session)
    # Sandbox containers run as uid 1000 (texuser); the bind-mounted dirs
    # must be writable by that uid regardless of the host user running us.
    src_dir.chmod(0o777)
    out_dir.chmod(0o777)

    # Path the *host* daemon can actually bind-mount for the sibling
    # container — see the CONTAINER_JOBS_DIR/HOST_JOBS_DIR note above.
    host_job_dir = f"{HOST_JOBS_DIR}/{job_rel}" if HOST_JOBS_DIR else str(job_dir)

    try:
        extracted = _safe_extract(tar_bytes, src_dir)
        if is_session:
            # Removes files for anything renamed/deleted in the project
            # since this session's cache was last populated — tar
            # extraction only ever adds/overwrites, never deletes.
            _prune_missing(src_dir, extracted)
    except Exception:
        # A one-shot job's dir is scratch space for this call alone — wipe
        # it. A session's cache holds genuinely useful prior state from
        # earlier *successful* compiles; a failed extraction attempt on
        # this one call shouldn't discard it.
        if not is_session:
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

        if on_step is not None:
            threading.Thread(target=_track_compile_steps, args=(container, on_step), daemon=True).start()

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
        if is_session:
            try:
                os.utime(job_dir, None)  # idle-eviction freshness marker, see sweep_idle_sessions
            except FileNotFoundError:
                pass  # swept concurrently by sweep_idle_sessions — fine, see its own doc comment
        else:
            shutil.rmtree(job_dir, ignore_errors=True)


def _read_capped(path: Path) -> bytes | None:
    if not path.exists():
        return None
    if path.stat().st_size > MAX_OUTPUT_BYTES:
        return None
    return path.read_bytes()
