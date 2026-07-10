# ADR: Real-time collaboration transport

**Status:** accepted (Phase 0)

## Decision

Use the **Node `collab` service** running `y-websocket` as the Yjs sync transport (PLAN.md §6, default option), rather than Django Channels + `pycrdt`.

## Rationale

- `y-websocket` is Yjs's reference server implementation — best-documented, most battle-tested path for CRDT sync.
- Keeps Node confined to exactly one service; the rest of the stack (`api`, `compile`) stays Python.
- Avoids taking on `pycrdt`'s smaller-community risk for a component that is on the critical path for Phase 5 (real-time collaboration).

## Consequences

- The stack has two backend languages (Python for `api`/`compile`, Node for `collab`, plus Node/TS for `web`). Isolated behind an interface: `api` talks to `collab` only over its WebSocket/HTTP surface, never by importing Node code.
- `apps/collab` currently exposes only `GET /health` and a bare WebSocket upgrade (Phase 0 stub). Yjs document sync (`yjs` + `y-websocket` server utils) and periodic persistence to storage/Postgres are implemented in Phase 5.
