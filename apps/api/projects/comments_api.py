"""Comments (Plan.md §9 Phase 8): a comment anchored to a line in a file,
with one level of flat replies. Any project member can comment, reply, or
refresh a comment's anchor position; only owners/editors can resolve a
thread; a comment can be manually deleted by its own author or by an owner,
or auto-deleted by anyone who can edit content once its anchored text no
longer exists anywhere in the file (see Comment's own docstring and
delete_orphaned_comment below).
"""

import uuid

from django.utils import timezone
from ninja import Router, Schema
from ninja.errors import HttpError

from accounts.auth import SessionAuth
from core import storage
from core.session import get_current_user

from .authz import get_authorized_project, require_role
from .models import Comment, FileType, Role

router = Router(auth=SessionAuth())


def _display_name(user) -> str | None:
    if user is None:
        return None
    return user.display_name or user.email or user.orcid_id


class ReplyOut(Schema):
    id: uuid.UUID
    body: str
    created_at: str
    created_by_name: str | None = None
    is_you: bool = False


class CommentOut(Schema):
    id: uuid.UUID
    anchor_line: int
    anchor_from: int | None = None
    anchor_to: int | None = None
    anchor_text: str | None = None
    body: str
    created_at: str
    created_by_name: str | None = None
    is_you: bool = False
    can_delete: bool = False
    resolved: bool
    resolved_by_name: str | None = None
    resolved_at: str | None = None
    replies: list[ReplyOut]


def _reply_out(reply: Comment, user) -> ReplyOut:
    return ReplyOut(
        id=reply.id,
        body=reply.body,
        created_at=reply.created_at.isoformat(),
        created_by_name=_display_name(reply.created_by),
        is_you=reply.created_by_id == user.id,
    )


def _comment_out(comment: Comment, user, is_owner: bool) -> CommentOut:
    return CommentOut(
        id=comment.id,
        anchor_line=comment.anchor_line,
        anchor_from=comment.anchor_from,
        anchor_to=comment.anchor_to,
        anchor_text=comment.anchor_text,
        body=comment.body,
        created_at=comment.created_at.isoformat(),
        created_by_name=_display_name(comment.created_by),
        is_you=comment.created_by_id == user.id,
        can_delete=is_owner or comment.created_by_id == user.id,
        resolved=comment.resolved,
        resolved_by_name=_display_name(comment.resolved_by),
        resolved_at=comment.resolved_at.isoformat() if comment.resolved_at else None,
        replies=[_reply_out(r, user) for r in comment.replies.select_related("created_by").order_by("created_at")],
    )


def _get_file_or_404(project, file_id: uuid.UUID):
    f = project.files.filter(id=file_id).exclude(type=FileType.FOLDER).first()
    if f is None:
        raise HttpError(404, "File not found.")
    return f


@router.get("/projects/{project_id}/files/{file_id}/comments", response=list[CommentOut])
def list_comments(request, project_id: uuid.UUID, file_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    f = _get_file_or_404(project, file_id)
    is_owner = membership.role == Role.OWNER

    top_level = f.comments.filter(parent=None).select_related("created_by", "resolved_by").order_by("created_at")
    return [_comment_out(c, user, is_owner) for c in top_level]


class CommentCreateIn(Schema):
    anchor_line: int = 1
    anchor_from: int | None = None
    anchor_to: int | None = None
    anchor_text: str | None = None
    body: str
    parent_id: uuid.UUID | None = None


@router.post("/projects/{project_id}/files/{file_id}/comments", response=CommentOut)
def create_comment(request, project_id: uuid.UUID, file_id: uuid.UUID, payload: CommentCreateIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    f = _get_file_or_404(project, file_id)

    body = payload.body.strip()
    if not body:
        raise HttpError(400, "Comment body can't be empty.")

    parent = None
    anchor_line = max(1, payload.anchor_line)
    anchor_from = payload.anchor_from
    anchor_to = payload.anchor_to
    anchor_text = payload.anchor_text
    if anchor_from is None or anchor_to is None or anchor_to <= anchor_from:
        anchor_from = anchor_to = anchor_text = None
    if payload.parent_id is not None:
        parent = f.comments.filter(id=payload.parent_id).first()
        if parent is None:
            raise HttpError(404, "Parent comment not found.")
        if parent.parent_id is not None:
            raise HttpError(400, "Replies can't themselves be replied to.")
        anchor_line = parent.anchor_line
        anchor_from = anchor_to = anchor_text = None

    comment = Comment.objects.create(
        project=project,
        file=f,
        parent=parent,
        anchor_line=anchor_line,
        anchor_from=anchor_from,
        anchor_to=anchor_to,
        anchor_text=anchor_text,
        body=body,
        created_by=user,
    )
    is_owner = membership.role == Role.OWNER
    return _comment_out(comment, user, is_owner)


def _get_comment_or_404(project, comment_id: uuid.UUID) -> Comment:
    comment = project.comments.filter(id=comment_id).select_related("created_by", "resolved_by").first()
    if comment is None:
        raise HttpError(404, "Comment not found.")
    return comment


class ResolveIn(Schema):
    resolved: bool = True


@router.patch("/projects/{project_id}/comments/{comment_id}/resolve", response=CommentOut)
def resolve_comment(request, project_id: uuid.UUID, comment_id: uuid.UUID, payload: ResolveIn):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR)
    comment = _get_comment_or_404(project, comment_id)
    if comment.parent_id is not None:
        raise HttpError(400, "Only top-level comments can be resolved.")

    comment.resolved = payload.resolved
    comment.resolved_by = user if payload.resolved else None
    comment.resolved_at = timezone.now() if payload.resolved else None
    comment.save(update_fields=["resolved", "resolved_by", "resolved_at"])
    is_owner = membership.role == Role.OWNER
    return _comment_out(comment, user, is_owner)


@router.delete("/projects/{project_id}/comments/{comment_id}")
def delete_comment(request, project_id: uuid.UUID, comment_id: uuid.UUID):
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    comment = _get_comment_or_404(project, comment_id)
    if membership.role != Role.OWNER and comment.created_by_id != user.id:
        raise HttpError(403, "You can only delete your own comments.")
    comment.delete()
    return {"ok": True}


class UpdateAnchorIn(Schema):
    anchor_line: int
    anchor_from: int
    anchor_to: int


@router.patch("/projects/{project_id}/comments/{comment_id}/anchor", response=CommentOut)
def update_anchor(request, project_id: uuid.UUID, comment_id: uuid.UUID, payload: UpdateAnchorIn):
    """Refreshes a top-level comment's cached line/offset after the client
    re-located its (unchanged) `anchor_text` in the live document — see
    Comment's docstring. Same "any project member" permission as commenting
    itself: this only corrects where an existing comment's own text now
    sits, never its content, so it carries no more trust than posting a
    comment in the first place.
    """
    user = get_current_user(request)
    project, _membership = get_authorized_project(user, project_id)
    comment = _get_comment_or_404(project, comment_id)
    if comment.parent_id is not None:
        raise HttpError(400, "Only top-level comments carry their own anchor.")
    if payload.anchor_to <= payload.anchor_from:
        raise HttpError(400, "anchor_to must be greater than anchor_from.")

    comment.anchor_line = max(1, payload.anchor_line)
    comment.anchor_from = payload.anchor_from
    comment.anchor_to = payload.anchor_to
    comment.save(update_fields=["anchor_line", "anchor_from", "anchor_to"])
    is_owner = _membership.role == Role.OWNER
    return _comment_out(comment, user, is_owner)


@router.delete("/projects/{project_id}/comments/{comment_id}/orphaned")
def delete_orphaned_comment(request, project_id: uuid.UUID, comment_id: uuid.UUID):
    """Deletes a comment whose anchored text no longer exists anywhere in
    its file — called by any client the moment it notices this while
    re-anchoring, not just the comment's own author or the project owner
    (unlike the regular delete endpoint above), since the edit that made a
    comment's text disappear is very often made by someone other than that
    comment's author. Open to any role that can actually change file
    content (owner/editor/reviewer, not a read-only viewer), and re-verifies
    the claim against the file's current *stored* content server-side
    rather than trusting the caller outright — a comment can briefly outlive
    an edit that orphaned it until the next periodic flush catches up (see
    apps/collab Room.flush), which just means this returns 409 and the
    caller's next re-anchor pass tries again, not that anything is wrong.
    """
    user = get_current_user(request)
    project, membership = get_authorized_project(user, project_id)
    require_role(membership, Role.OWNER, Role.EDITOR, Role.REVIEWER)
    comment = _get_comment_or_404(project, comment_id)
    if comment.parent_id is not None:
        raise HttpError(400, "Only top-level comments can be pruned this way.")
    if not comment.anchor_text:
        raise HttpError(400, "This comment has no anchored text to verify.")

    content = storage.get_object(comment.file.storage_key).decode(errors="replace")
    if comment.anchor_text in content:
        raise HttpError(409, "The anchored text is still present in the file — not deleting.")

    comment.delete()
    return {"ok": True}
