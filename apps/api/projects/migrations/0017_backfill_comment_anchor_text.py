"""One-time best-effort backfill for comments made before comment anchoring
switched to re-locating captured text (see docs/decisions/comment-anchoring.md
and Comment's own docstring). A plain "whole line" comment made under the old
design has anchor_text/anchor_from/anchor_to all null — there's no way to
know what text the comment was *originally* about (the old code discarded
that), so this adopts whatever text currently occupies the comment's stored
anchor_line as a best guess. Accurate for a comment on a line that hasn't
changed since; could attach the wrong text for one on a line that has.
Skips a comment whose anchor_line no longer exists in the file, or is now
blank (an empty-string anchor would spuriously "match" the very start of
any document via the frontend's indexOf-based re-location).
"""

from django.db import migrations

from core import storage


def backfill_anchor_text(apps, schema_editor):
    Comment = apps.get_model("projects", "Comment")
    comments = Comment.objects.filter(parent__isnull=True, anchor_text__isnull=True).select_related("file")
    for comment in comments:
        if not comment.file.storage_key:
            continue
        try:
            content = storage.get_object(comment.file.storage_key).decode(errors="replace")
        except Exception:
            continue

        lines = content.split("\n")
        if comment.anchor_line < 1 or comment.anchor_line > len(lines):
            continue
        line_text = lines[comment.anchor_line - 1]
        if not line_text.strip():
            continue

        from_offset = sum(len(l) + 1 for l in lines[: comment.anchor_line - 1])
        comment.anchor_from = from_offset
        comment.anchor_to = from_offset + len(line_text)
        comment.anchor_text = line_text
        comment.save(update_fields=["anchor_from", "anchor_to", "anchor_text"])


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0016_projectcollection_membership_collection_and_more"),
    ]

    operations = [
        migrations.RunPython(backfill_anchor_text, migrations.RunPython.noop),
    ]
