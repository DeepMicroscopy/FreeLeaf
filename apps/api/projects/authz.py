from ninja.errors import HttpError

from .models import Membership, Project, Role


def get_authorized_project(user, project_id) -> tuple[Project, Membership]:
    """Return (project, membership) if `user` has any membership on the
    project, else raise 404 — including when the project doesn't exist, so
    unauthorized callers can't distinguish "no access" from "doesn't exist".
    """
    if user is None:
        raise HttpError(401, "Authentication required.")
    membership = (
        Membership.objects.filter(project_id=project_id, user=user).select_related("project").first()
    )
    if membership is None:
        raise HttpError(404, "Project not found.")
    return membership.project, membership


def require_role(membership: Membership, *roles: str) -> None:
    if membership.role not in roles:
        raise HttpError(403, "You don't have permission to do that.")


__all__ = ["get_authorized_project", "require_role", "Role"]
