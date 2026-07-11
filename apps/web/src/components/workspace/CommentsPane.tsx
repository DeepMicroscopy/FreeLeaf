import { api } from "@freeleaf/shared";
import type { components } from "@freeleaf/shared";
import { Check, MessageSquare, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Spinner } from "../ui/Spinner";
import styles from "./CommentsPane.module.css";

type CommentOut = components["schemas"]["CommentOut"];

export interface PendingCommentAnchor {
  line: number;
  from: number;
  to: number;
  text: string;
}

export function CommentsPane({
  projectId,
  fileId,
  canResolve,
  currentLine,
  onJumpToLine,
  pendingAnchor,
  onClearPendingAnchor,
  onCommentsChange,
}: {
  projectId: string;
  fileId: string;
  canResolve: boolean;
  currentLine: number;
  onJumpToLine: (line: number) => void;
  /** A marked-text selection picked via the editor's right-click "Add
   * comment" menu, waiting to be attached to the next top-level comment
   * posted from this pane — see CodeMirrorEditor's `onAddComment`. */
  pendingAnchor?: PendingCommentAnchor | null;
  onClearPendingAnchor?: () => void;
  onCommentsChange?: (comments: CommentOut[]) => void;
}) {
  const [comments, setComments] = useState<CommentOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

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

  const handlePost = useCallback(async () => {
    const body = newBody.trim();
    if (!body) return;
    setPosting(true);
    const { data } = await api.POST("/api/projects/{project_id}/files/{file_id}/comments", {
      params: { path: { project_id: projectId, file_id: fileId } },
      body: pendingAnchor
        ? {
            body,
            anchor_line: pendingAnchor.line,
            anchor_from: pendingAnchor.from,
            anchor_to: pendingAnchor.to,
            anchor_text: pendingAnchor.text,
          }
        : { body, anchor_line: currentLine },
    });
    setPosting(false);
    if (data) {
      setNewBody("");
      onClearPendingAnchor?.();
      void load();
    }
  }, [projectId, fileId, currentLine, pendingAnchor, newBody, onClearPendingAnchor, load]);

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

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h2 className={styles.title}>Comments</h2>
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
      ) : (
        <ul className={styles.list}>
          {comments.map((c) => (
            <li key={c.id} className={[styles.thread, c.resolved ? styles.resolved : ""].join(" ")}>
              <CommentCard
                comment={c}
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
  canResolve,
  onJumpToLine,
  onResolve,
  onDelete,
}: {
  comment: CommentOut;
  canResolve: boolean;
  onJumpToLine: (line: number) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <div className={styles.commentMeta}>
        <span className={styles.author}>{comment.created_by_name ?? "Anonymous"}</span>
        <button className={styles.lineLink} onClick={() => onJumpToLine(comment.anchor_line)}>
          Line {comment.anchor_line}
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
