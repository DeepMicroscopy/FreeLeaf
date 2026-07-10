# ADR: Compile sandbox mechanism — Docker-in-Docker via the host socket

**Status:** accepted (Phase 3), interim — see Consequences

## Decision

`apps/compile` spawns one ephemeral container per compile job from the `freeleaf-texlive` image (`docker/texlive/`), talking to the Docker Engine API over `/var/run/docker.sock` (mounted read-write into the `compile` container). Every job container runs with `--network none`, `--cap-drop ALL`, a pids limit, memory/CPU limits, a read-only root filesystem, a non-root user (`texuser`, uid 1000), and a wall-clock timeout enforced by `compile` itself (kills the container if exceeded). Full detail in `apps/compile/sandbox.py`.

Plan.md §7 explicitly names this as the expected default: "Docker-in-Docker for dev; gVisor/Firecracker/nsjail possible in prod." This ADR is that documented choice, plus the two changes it forced.

## Why `compile` runs as root

The `compile` container itself (not the per-job `freeleaf-texlive` containers it spawns) runs as root, breaking this project's otherwise-universal non-root convention. Reaching the Docker socket requires matching its host-side group ownership, which varies across hosts (`docker` group GID isn't fixed); a non-root user in the container can't reliably get access without a GID-matching entrypoint script that's itself fragile across environments. `compile` never executes user-supplied LaTeX or any other untrusted code directly — its only job is orchestrating the containers that do, and those containers get the full lockdown above. Root here is scoped to "can talk to the Docker daemon," which is already a highly privileged capability (roughly equivalent to root on the host) regardless of the container's own UID.

## Consequences

- **This is a real, accepted risk, not a hardened boundary.** Anything that compromises `apps/compile` (a bug in its own code, a vulnerability in the `docker` Python SDK, etc.) gets Docker-socket access, which is host-root-equivalent. This is why `compile` has no public port and is only ever reached from `api` over the internal Compose network.
- **Production currently inherits the same tradeoff as dev.** `docker-compose.prod.yml` wires the socket the same way. Plan.md's named production path — gVisor, Firecracker, or nsjail instead of Docker-in-Docker — is not implemented. Before a real multi-tenant production deployment, replace `sandbox.py`'s Docker Engine API calls with one of those, or run `compile` on isolated infrastructure where the blast radius of socket access is acceptable (e.g. a dedicated VM with nothing else on it).
- The `freeleaf-texlive` sandbox image itself (what actually runs user LaTeX) is genuinely locked down per §7 and is the real security boundary for the untrusted-input path; the Docker-in-Docker concern above is about the *orchestrator's* privilege, not the compile job's.
