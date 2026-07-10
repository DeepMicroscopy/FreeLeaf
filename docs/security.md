# Security: the compile sandbox

FreeLeaf compiles LaTeX supplied by users of a self-hosted instance — including anonymous, unauthenticated-by-account contributors via share links. **All submitted LaTeX is treated as untrusted, potentially malicious code**, not just documents. This is the single most important technical constraint in the project (Plan.md §3/§7).

## What LaTeX can do if unsandboxed

LaTeX is a full programming environment. Left unrestricted, a document can:
- Execute arbitrary shell commands via `\write18{...}` / shell-escape-dependent packages (`minted`, `svg`, etc.).
- Read/write/exfiltrate any file the compiling process can reach.
- Make network requests (data exfiltration, SSRF against internal infrastructure, abusing the host as a relay).
- Consume unbounded CPU/memory/disk, or hang forever (denial of service).
- Escape into other users' projects on the same host if compile jobs aren't isolated from each other.

## Controls (`apps/compile/sandbox.py`, `docker/texlive/`)

| Threat | Control |
|---|---|
| `\write18` / shell-escape | `-no-shell-escape` compiled directly into the `$pdflatex`/`$xelatex` engine command latexmk invokes — not relying on latexmk's own (nonexistent) shell-escape-disable flag or the image's `texmf.cnf` default. Verified against latexmk's actual documentation before implementing (no native `-no-shell-escape` flag exists on latexmk itself). |
| Network exfiltration / SSRF | Every job container runs with `network_disabled=True` (`--network none`) — no network namespace access at all. |
| Cross-job / cross-project interference | Fresh container per job (`docker.containers.run(..., detach=True)`, always removed after); only that job's own temp directory is bind-mounted in. No job ever sees another job's files. |
| Reading/writing arbitrary host files | Bind mounts are limited to the job's own `src` (read-only) and `out` (read-write) directories; container root filesystem is `read_only=True`; `/tmp` is a size-capped `tmpfs`. |
| Runaway CPU/memory | `mem_limit="1g"`, `nano_cpus=1_000_000_000` (1 CPU). |
| Fork bombs / process exhaustion | `pids_limit=100`. |
| Infinite/hung compiles | Wall-clock timeout (60s) enforced by `compile` itself via the container `wait()` call; on expiry the container is force-killed, not just abandoned. |
| Privilege escalation inside the job container | `cap_drop=["ALL"]`, `security_opt=["no-new-privileges"]`, non-root `user="1000:1000"` (the image's own default user, set explicitly too as defense in depth), no privileged mode. |
| Path traversal via project file paths | Two independent layers: `projects/paths.py` validates every path at file-creation time (reject `..`, absolute paths, disallowed characters); `sandbox.py`'s `_safe_extract()` independently re-validates every tar member before extraction (refuses symlinks/hardlinks and any path that would resolve outside the job directory), since untrusted-content-becomes-filesystem-write is exactly the class of bug that's cheap to introduce and expensive to miss (see CVE-2007-4559-style tarfile extraction vulnerabilities). |
| Output size abuse | Compile responses cap PDF/synctex reads at 50 MB (`MAX_OUTPUT_BYTES`); oversized outputs are dropped rather than causing the api/compile round-trip to balloon. |

## What isn't covered yet

- **`compile`'s own privilege.** `apps/compile` talks to the host Docker socket to spawn job containers, which is a real, accepted risk documented separately in `docs/decisions/compile-sandbox.md` — read that before relying on this sandbox in a genuinely hostile multi-tenant deployment. The production-hardened path Plan.md names (gVisor/Firecracker/nsjail instead of Docker-in-Docker) isn't implemented yet.
- **Compile-request rate limiting.** `POST /projects/:id/compile` doesn't yet have its own rate limit beyond normal membership/role checks — a project member could still trigger enough concurrent compiles to exhaust host resources (each capped at 1 CPU/1GB/60s, but N of them in parallel isn't bounded here). Worth adding alongside real usage data on what limits make sense.
- **Malicious package/class files.** A `.tex`/`.cls`/`.sty` file can still do a lot of legal-LaTeX-but-unwanted things within the sandbox's limits (e.g. a document deliberately structured to be slow to typeset, right up to the timeout). The sandbox bounds the *blast radius*, not the *legitimacy* of what a document tries to do.
