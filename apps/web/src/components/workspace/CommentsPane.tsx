import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Check, Eye, EyeOff, MessageSquare, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import { lineBounds, locateCommentAnchors } from "./commentAnchorsExtension";
import styles from "./CommentsPane.module.css";

type CommentOut = components["schemas"]["CommentOut"];

export interface PendingCommentAnchor {
  line: number;
  from: number;
  to: number;
  text: string;
}

interface ResolvedAnchor {
  from: number;
  to: number;
  line: number;
}

// Debounced re-anchor pass: prompt enough to feel immediate after a pause in
// typing, without re-running a text search over every comment on every
// keystroke. The periodic fallback below exists only for the retry case
// described at its own call site.
const REANCHOR_DEBOUNCE_MS = 1500;
const REANCHOR_RETRY_MS = 5000;

export function CommentsPane({
  projectId,
  fileId,
  canResolve,
  canEditText,
  currentLine,
  docText,
  onJumpToLine,
  pendingAnchor,
  onClearPendingAnchor,
  onCommentsChange,
  onResolvedAnchorsChange,
  focusedComment,
}: {
  projectId: string;
  fileId: string;
  canResolve: boolean;
  /** Owner/editor/reviewer — anyone who can actually change file content,
   * matching the backend's permission for update_anchor/delete_orphaned
   * (comments_api.py). Gates whether this client writes back refreshed
   * positions or prunes orphaned comments at all; a viewer still sees the
   * live-resolved positions (read-only), just never the one acting on them. */
  canEditText: boolean;
  currentLine: number;
  /** The file's current live text (EditorTab's onDocTextChange) — used to
   * re-locate each comment's anchor_text instead of trusting its possibly
   * stale stored offsets. See docs/decisions/comment-anchoring.md. */
  docText: string;
  onJumpToLine: (line: number) => void;
  /** A marked-text selection picked via the editor's right-click "Add
   * comment" menu, waiting to be attached to the next top-level comment
   * posted from this pane — see CodeMirrorEditor's `onAddComment`. */
  pendingAnchor?: PendingCommentAnchor | null;
  onClearPendingAnchor?: () => void;
  onCommentsChange?: (comments: CommentOut[]) => void;
  /** The live-resolved position of every top-level comment whose anchor
   * text could still be found — lets EditorTab feed the editor's own
   * highlight decorations the same up-to-date positions this pane displays,
   * instead of the comments' raw (possibly stale) stored offsets. */
  onResolvedAnchorsChange?: (anchors: Map<string, ResolvedAnchor>) => void;
  /** Set when the user clicked a comment's highlighted marked text in the
   * editor — scrolls that thread into view and briefly flashes it so it's
   * obvious which comment the click was about. `token` increments on every
   * click so clicking the same anchor again re-triggers the effect even
   * though `id` is unchanged. */
  focusedComment?: { id: string; token: number } | null;
}) {
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [flashedId, setFlashedId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const hideResolvedKey = `freeleaf.hideResolvedComments.${projectId}`;
  const [hideResolved, setHideResolvedState] = useState(() => localStorage.getItem(hideResolvedKey) === "1");
  const setHideResolved = useCallback(
    (value: boolean) => {
      setHideResolvedState(value);
      localStorage.setItem(hideResolvedKey, value ? "1" : "0");
    },
    [hideResolvedKey],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await api.GET("/api/projects/{project_id}/files/{file_id}/comments", {
      params: { path: { project_id: projectId, file_id: fileId } },
    });
    setComments(data ?? []);
    setLoading(false);
  }, [projectId, fileId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onCommentsChange?.(comments);
  }, [comments, onCommentsChange]);

  // Re-anchors every top-level comment against the live document on each
  // settle, rather than trusting stored anchor_from/anchor_to/anchor_line —
  // see docs/decisions/comment-anchoring.md. Read-only (resolvedAnchors,
  // reported up for the editor's own highlighting) happens regardless of
  // role; writing the refreshed position back and pruning an orphaned
  // comment only happen for a role that could itself have caused the edit.
  const [resolvedAnchors, setResolvedAnchors] = useState<Map<string, ResolvedAnchor>>(new Map());
  const reconcileAnchors = useCallback(async () => {
    const anchors = comments
      .filter((c) => c.anchor_text != null && c.anchor_from != null)
      .map((c) => ({ id: c.id, text: c.anchor_text!, hintFrom: c.anchor_from! }));
    const located = locateCommentAnchors(docText, anchors);

    const nextResolved = new Map<string, ResolvedAnchor>();
    const orphanedIds: string[] = [];
    for (const c of comments) {
      if (c.anchor_text == null) continue;
      const loc = located.get(c.id);
      if (!loc) {
        orphanedIds.push(c.id);
        continue;
      }
      nextResolved.set(c.id, { from: loc.from, to: loc.to, line: docText.slice(0, loc.from).split("\n").length });
    }
    setResolvedAnchors(nextResolved);
    onResolvedAnchorsChange?.(nextResolved);

    if (!canEditText) return;

    for (const c of comments) {
      const resolved = nextResolved.get(c.id);
      if (!resolved) continue;
      if (resolved.from === c.anchor_from && resolved.to === c.anchor_to && resolved.line === c.anchor_line) continue;
      void api.PATCH("/api/projects/{project_id}/comments/{comment_id}/anchor", {
        params: { path: { project_id: projectId, comment_id: c.id } },
        body: { anchor_line: resolved.line, anchor_from: resolved.from, anchor_to: resolved.to },
      });
    }

    if (orphanedIds.length === 0) return;
    let anyDeleted = false;
    for (const id of orphanedIds) {
      // 409 means the file's *stored* content (periodically flushed, see
      // apps/collab Room.flush) hasn't caught up with this edit yet, not
      // that anything's wrong — the retry timer below tries again shortly.
      const { error } = await api.DELETE("/api/projects/{project_id}/comments/{comment_id}/orphaned", {
        params: { path: { project_id: projectId, comment_id: id } },
      });
      if (!error) anyDeleted = true;
    }
    if (anyDeleted) void load();
  }, [comments, docText, canEditText, projectId, onResolvedAnchorsChange, load]);

  useEffect(() => {
    if (!docText) return;
    const timer = setTimeout(() => void reconcileAnchors(), REANCHOR_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [docText, reconcileAnchors]);

  // Catches the rare case above where an orphan-delete was rejected because
  // storage hadn't flushed yet and the user then stopped typing — without
  // this, nothing would ever trigger another reconcile pass to retry it.
  useEffect(() => {
    if (!docText || !canEditText) return;
    const timer = setInterval(() => void reconcileAnchors(), REANCHOR_RETRY_MS);
    return () => clearInterval(timer);
  }, [docText, canEditText, reconcileAnchors]);

  useEffect(() => {
    if (!focusedComment) return;
    const el = itemRefs.current.get(focusedComment.id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashedId(focusedComment.id);
    const timer = setTimeout(() => setFlashedId(null), 1600);
    return () => clearTimeout(timer);
  }, [focusedComment?.id, focusedComment?.token]);

  const handlePost = useCallback(async () => {
    const body = newBody.trim();
    if (!body) return;
    setPosting(true);
    // No marked selection -> anchor to the whole current line's text, same
    // "anchor to real text" treatment as a selection (see lineBounds) rather
    // than just a bare line number with nothing to re-locate later.
    const anchor = pendingAnchor ?? lineBounds(docText, currentLine);
    const { data } = await api.POST("/api/projects/{project_id}/files/{file_id}/comments", {
      params: { path: { project_id: projectId, file_id: fileId } },
      body: anchor
        ? {
            body,
            anchor_line: pendingAnchor?.line ?? currentLine,
            anchor_from: anchor.from,
            anchor_to: anchor.to,
            anchor_text: anchor.text,
          }
        : { body, anchor_line: currentLine },
    });
    setPosting(false);
    if (data) {
      setNewBody("");
      onClearPendingAnchor?.();
      void load();
    }
  }, [projectId, fileId, currentLine, docText, pendingAnchor, newBody, onClearPendingAnchor, load]);

  const handleReply = useCallback(
    async (parentId: string) => {
      const body = replyBody.trim();
      if (!body) return;
      const { data } = await api.POST("/api/projects/{project_id}/files/{file_id}/comments", {
        params: { path: { project_id: projectId, file_id: fileId } },
        body: { body, anchor_line: 1, parent_id: parentId },
      });
      if (data) {
        setReplyBody("");
        setReplyingTo(null);
        void load();
      }
    },
    [projectId, fileId, replyBody, load],
  );

  const handleResolve = useCallback(
    async (commentId: string, resolved: boolean) => {
      const { data } = await api.PATCH("/api/projects/{project_id}/comments/{comment_id}/resolve", {
        params: { path: { project_id: projectId, comment_id: commentId } },
        body: { resolved },
      });
      if (data) void load();
    },
    [projectId, load],
  );

  const handleDelete = useCallback(
    async (commentId: string) => {
      const { error } = await api.DELETE("/api/projects/{project_id}/comments/{comment_id}", {
        params: { path: { project_id: projectId, comment_id: commentId } },
      });
      if (!error) void load();
    },
    [projectId, load],
  );

  const resolvedCount = comments.filter((c) => c.resolved).length;
  // By current (live-resolved, falling back to stored) line/position rather
  // than creation order — reading top-to-bottom through the document should
  // match reading top-to-bottom through the comments.
  const sortedComments = [...comments].sort((a, b) => {
    const ra = resolvedAnchors.get(a.id);
    const rb = resolvedAnchors.get(b.id);
    const lineA = ra?.line ?? a.anchor_line;
    const lineB = rb?.line ?? b.anchor_line;
    return lineA - lineB || (ra?.from ?? a.anchor_from ?? 0) - (rb?.from ?? b.anchor_from ?? 0);
  });
  const visibleComments = hideResolved ? sortedComments.filter((c) => !c.resolved) : sortedComments;

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h2 className={styles.title}>Comments</h2>
        {resolvedCount > 0 && (
          <button
            type="button"
            className={styles.actionLink}
            onClick={() => setHideResolved(!hideResolved)}
            title={hideResolved ? "Show resolved comments" : "Hide resolved comments"}
          >
            {hideResolved ? (
              <>
                <Eye size={12} aria-hidden="true" /> Show resolved ({resolvedCount})
              </>
            ) : (
              <>
                <EyeOff size={12} aria-hidden="true" /> Hide resolved
              </>
            )}
          </button>
        )}
      </div>

      <div className={styles.newComment}>
        {pendingAnchor ? (
          <div className={styles.pendingAnchor}>
            <blockquote className={styles.pendingAnchorQuote}>“{pendingAnchor.text}”</blockquote>
            <button
              className={styles.pendingAnchorClear}
              onClick={() => onClearPendingAnchor?.()}
              title="Comment on the whole line instead"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className={styles.newCommentLine}>On line {currentLine}</div>
        )}
        <textarea
          className={styles.textarea}
          placeholder="Add a comment…"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          rows={2}
        />
        <div className={styles.newCommentActions}>
          <Button size="sm" onClick={handlePost} loading={posting} disabled={!newBody.trim()}>
            Comment
          </Button>
        </div>
      </div>

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
        </div>
      ) : comments.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} aria-hidden="true" />}
          title="No comments yet"
          description="Comments on this file will show up here."
        />
      ) : visibleComments.length === 0 ? (
        <EmptyState
          icon={<Check size={28} aria-hidden="true" />}
          title="All comments resolved"
          description="Click “Show resolved” to see them again."
        />
      ) : (
        <ul className={styles.list}>
          {visibleComments.map((c) => (
            <li
              key={c.id}
              ref={(el) => {
                if (el) itemRefs.current.set(c.id, el);
                else itemRefs.current.delete(c.id);
              }}
              className={[
                styles.thread,
                c.resolved ? styles.resolved : "",
                flashedId === c.id ? styles.flash : "",
              ].join(" ")}
            >
              <CommentCard
                comment={c}
                line={resolvedAnchors.get(c.id)?.line ?? c.anchor_line}
                canResolve={canResolve}
                onJumpToLine={onJumpToLine}
                onResolve={handleResolve}
                onDelete={handleDelete}
              />
              {c.replies.map((r) => (
                <div key={r.id} className={styles.reply}>
                  <div className={styles.commentMeta}>
                    <span className={styles.author}>{r.created_by_name ?? "Anonymous"}</span>
                    <span className={styles.time}>{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className={styles.body}>{r.body}</div>
                </div>
              ))}
              {!c.resolved &&
                (replyingTo === c.id ? (
                  <div className={styles.replyForm}>
                    <textarea
                      className={styles.textarea}
                      placeholder="Reply…"
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={2}
                      autoFocus
                    />
                    <div className={styles.newCommentActions}>
                      <Button variant="ghost" size="sm" onClick={() => setReplyingTo(null)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={() => handleReply(c.id)} disabled={!replyBody.trim()}>
                        Reply
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={styles.replyLink}
                    onClick={() => {
                      setReplyingTo(c.id);
                      setReplyBody("");
                    }}
                  >
                    Reply
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentCard({
  comment,
  line,
  canResolve,
  onJumpToLine,
  onResolve,
  onDelete,
}: {
  comment: CommentOut;
  /** The comment's current line — live-resolved by the parent whenever
   * possible, falling back to the comment's stored anchor_line. */
  line: number;
  canResolve: boolean;
  onJumpToLine: (line: number) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className={styles.commentMeta}>
        <span className={styles.author}>{comment.created_by_name ?? "Anonymous"}</span>
        <button className={styles.lineLink} onClick={() => onJumpToLine(line)}>
          Line {line}
        </button>
        <span className={styles.time}>{new Date(comment.created_at).toLocaleString()}</span>
      </div>
      {comment.anchor_text && <blockquote className={styles.anchorQuote}>“{comment.anchor_text}”</blockquote>}
      <div className={styles.body}>{comment.body}</div>
      <div className={styles.actions}>
        {comment.resolved ? (
          <span className={styles.resolvedTag}>
            <Check size={12} aria-hidden="true" /> Resolved
            {comment.resolved_by_name ? ` by ${comment.resolved_by_name}` : ""}
          </span>
        ) : null}
        {canResolve && (
          <button className={styles.actionLink} onClick={() => onResolve(comment.id, !comment.resolved)}>
            {comment.resolved ? (
              <>
                <Undo2 size={12} aria-hidden="true" /> Reopen
              </>
            ) : (
              <>
                <Check size={12} aria-hidden="true" /> Resolve
              </>
            )}
          </button>
        )}
        {comment.can_delete && (
          <button className={styles.actionLink} onClick={() => onDelete(comment.id)}>
            <Trash2 size={12} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
