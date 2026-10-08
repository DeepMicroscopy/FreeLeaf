# ADR: Personal project collections live on `Membership`, not a shared table

**Status:** accepted (Phase 13)

## Decision

A new `ProjectCollection` model (owned by one user) plus a nullable `collection` FK added directly onto the existing `Membership` row, not a separate `Project`-level or many-to-many join table.

## Rationale

This phase wasn't in the original phased plan — it's a user-requested, purely personal dashboard-organization feature with no bearing on shared project state. "Which collection is this project filed under, for me" is inherently scoped to one (user, project) pair, which `Membership` already uniquely represents (`unique_membership_per_project_user`). Putting it there means two co-authors on the same project can file it into their own, unrelated collections without any extra scoping logic, and it naturally disappears if the membership itself is ever removed.

## Consequences

- Deleting a `ProjectCollection` sets `Membership.collection` to null (`SET_NULL`) rather than touching the project or its other memberships.
- A project can belong to at most one collection per viewer (folder-like), never more than one — multi-collection tagging was explicitly not requested.
- Newly created, duplicated, or imported projects always start uncategorized; collection membership is never copied from a source project.
