# ADR: latexdiff runs in the compile orchestrator, not the sandbox

**Status:** accepted

## Decision

"Compile diff" (the compile dropdown's `latexdiff`-based option, offered only once a project's main document has a linked revision-diff baseline — Phase 14) runs `latexdiff` directly inside `apps/compile`'s own container, installed via its Dockerfile, rather than inside the ephemeral `freeleaf-texlive` sandbox (`docker/texlive/`, sandbox.py) that actually runs pdflatex/xelatex.

## Rationale

latexdiff is pure Perl text processing over two `.tex` sources — it never executes the LaTeX it reads, so it carries none of the risk §7's sandbox exists to contain (no shell-escape surface, no need for `--network none`/resource limits/non-root beyond what this already-trusted, already-has-filesystem-access orchestrator has). Running it there instead of inside the one-shot sandboxed container avoids teaching the sandbox image a second responsibility, and avoids giving the sandboxed container any reason to read a second source file beyond what it's compiling.

The merged, markup-injected output is written back into the job's own `src_dir`, next to the real main file (not a separate tmpdir), specifically so its relative `\input`/`\includegraphics`/`\bibliography` paths resolve exactly like the original document's did — latexdiff's output is compiled as a normal sibling file, not a differently-rooted standalone document.

## Consequences

- SyncTeX click-to-source against a diff-compiled PDF resolves into the synthetic `__freeleaf_latexdiff__.tex`, not a real project file — `EditorTab`'s jump handler already no-ops on an unknown file, so this is a silent no-op rather than an error, but it's a known gap (not fixed here).
- `latexdiff` failing (malformed input on either side) surfaces as a compile-service-level error (the same channel an unreachable compile service uses), before any LaTeX engine ever runs — not a normal "failed compile" with a log, since nothing was compiled yet.
