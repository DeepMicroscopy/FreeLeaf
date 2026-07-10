# ADR: ProjectFile gets a `folder` type

**Status:** accepted (Phase 2)

## Decision

`ProjectFile.type` includes `folder` in addition to Plan.md §8's literal enum (`tex|bib|image|other`).

## Rationale

Phase 2 explicitly requires sidebar create/rename/delete for "files & folders." An empty folder needs *some* persisted row to survive reload and be renameable/deletable as a unit — deriving folders purely from existing file path prefixes can't represent an empty folder. Extending the type enum is the smallest change that satisfies the phase's acceptance criteria without inventing a parallel folder table.

## Consequences

- Folder rows have `storage_key=null` (no content) and `size=0`.
- Renaming a folder bulk-updates the `path` prefix of all descendant rows in one transaction (`projects/files_api.py`).
- Deleting a folder cascades to all descendants (path-prefix match) and their storage objects.
