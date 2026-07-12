#!/usr/bin/env python3
"""Generates a short promo video for FreeLeaf, for sharing on LinkedIn.

Assembles the real screenshots under docs/assets/img into a narrated,
Ken-Burns-panned slideshow: title card -> one scene per claim (digital
sovereignty, collaboration, citations, comments, review modes, table
designer, compile/SyncTeX, version history, sign-in) -> outro/CTA card.

Requirements (all local, no API keys/network calls):
  - ffmpeg (with libx264/aac; on macOS: `brew install ffmpeg`, or an existing
    ffmpeg build like the one in this repo's conda env)
  - macOS `say` for narration text-to-speech (this script is macOS-only
    because of that; swap synthesize_narration() for another TTS engine,
    e.g. `espeak-ng` or `piper`, to run elsewhere)

Usage:
    python3 scripts/make_promo_video.py
    python3 scripts/make_promo_video.py --voice Samantha --out freeleaf_promo.mp4
    python3 scripts/make_promo_video.py --dry-run   # print the scene plan, do nothing

Output is a 1920x1080 H.264 MP4, roughly 85-90s with the default narration,
suitable for a LinkedIn post.
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = REPO_ROOT / "docs" / "assets" / "img"

WIDTH, HEIGHT, FPS = 1920, 1080, 25
BRAND_BG = "0x0f6a4c"  # matches the leaf-green accent used on the docs site
MIN_SCENE_SECONDS = 2.5
SCENE_PADDING_SECONDS = 0.7

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]

# Each scene: image is None for a solid-color title/outro card. `caption` is
# the short on-screen text (drawtext doesn't wrap, keep it to one short
# line); `narration` is the full sentence spoken over it.
SCENES = [
    {
        "image": None,
        "caption": "FreeLeaf",
        "subcaption": "Overleaf, but it's yours.",
        "narration": "What if your LaTeX editor didn't belong to someone else's cloud?",
    },
    {
        "image": "hero-workspace.png",
        "caption": "Digital sovereignty",
        "narration": (
            "FreeLeaf is open source and self-hostable, on your own infrastructure. "
            "Your documents, your database, your storage, your rules — full digital "
            "sovereignty over your research, with no third-party cloud in between."
        ),
    },
    {
        "image": "collab-merged-compile.png",
        "caption": "Real-time collaboration",
        "narration": (
            "Multiple authors edit the same document at once, live cursors and all — "
            "including edits made while offline, merged automatically."
        ),
    },
    {
        "image": "cite-autocomplete.png",
        "caption": "Citations that autocomplete",
        "narration": (
            "Paste BibTeX straight into the editor. Cite and ref autocomplete against "
            "your real bibliography and labels, and close their own braces."
        ),
    },
    {
        "image": "comments-marked-text.png",
        "caption": "Comments on the exact text",
        "narration": (
            "Select a phrase, right click, add a comment — the marked text stays "
            "highlighted, so nobody has to guess what line forty two meant."
        ),
    },
    {
        "image": "track-changes-markup.png",
        "caption": "Review & track changes",
        "narration": (
            "Reviewing mode marks up insertions and deletions inline against any "
            "saved baseline, no separate diff tool required."
        ),
    },
    {
        "image": "table-designer-open.png",
        "caption": "Table Designer",
        "narration": (
            "A spreadsheet-like grid editor for LaTeX tables — cell text, alignment, "
            "and borders, saved back to clean LaTeX."
        ),
    },
    {
        "image": "synctex-forward-search.png",
        "caption": "Sandboxed compiling, real SyncTeX",
        "narration": (
            "Pdflatex and xelatex run fully sandboxed. Command click in the PDF jumps "
            "straight to the matching source line, and back."
        ),
    },
    {
        "image": "version-history-diff.png",
        "caption": "Version history",
        "narration": (
            "Automatic checkpoints plus named versions, with a real side by side diff "
            "before you ever restore anything."
        ),
    },
    {
        "image": "login-sso-picker.png",
        "caption": "Sign in your way",
        "narration": (
            "ORCID, magic link email, anonymous contributors, or your institution's "
            "own SAML and LDAP single sign on."
        ),
    },
    {
        "image": None,
        "caption": "Self-host it today",
        "subcaption": "Free and open source, AGPL-3.0",
        "narration": (
            "FreeLeaf is free and open source software. Self-host it today, and keep "
            "your research where it belongs — with you."
        ),
    },
]


def _find_font() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    sys.exit("No usable font found — edit FONT_CANDIDATES in this script to point at one.")


def _check_tools() -> None:
    missing = [t for t in ("ffmpeg", "ffprobe", "say") if shutil.which(t) is None]
    if missing:
        sys.exit(
            f"Missing required tool(s): {', '.join(missing)}. "
            "ffmpeg/ffprobe: `brew install ffmpeg`. `say` is macOS-only — "
            "see this script's module docstring for swapping in another TTS engine."
        )


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext treats : \ ' and % as special inside the filter string.
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def synthesize_narration(text: str, out_path: Path, voice: str) -> float:
    aiff_path = out_path.with_suffix(".aiff")
    subprocess.run(["say", "-v", voice, "-o", str(aiff_path), text], check=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(aiff_path), "-ar", "44100", "-ac", "1", str(out_path)],
        check=True, capture_output=True,
    )
    return _probe_duration(out_path)


def _probe_duration(path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def render_scene(scene: dict, index: int, workdir: Path, voice: str, font: str) -> Path:
    narration_path = workdir / f"narration_{index:02d}.wav"
    narration_seconds = synthesize_narration(scene["narration"], narration_path, voice)
    scene_seconds = max(narration_seconds + SCENE_PADDING_SECONDS, MIN_SCENE_SECONDS)
    frames = round(scene_seconds * FPS)

    is_card = scene["image"] is None
    caption = _escape_drawtext(scene["caption"])
    box = "box=1:boxcolor=black@0.55:boxborderw=18:"
    if is_card:
        # Solid-color title/outro card: center the text block vertically.
        caption_y = "(h-text_h)/2" if not scene.get("subcaption") else "(h/2)-70"
        sub_y = "(h/2)+20"
    else:
        # Screenshot caption: anchored near the bottom, out of the way of the UI.
        caption_y = "h-200"
        sub_y = "h-130"
    caption_draw = (
        f"drawtext=fontfile='{font}':text='{caption}':fontcolor=white:fontsize=64:{box}"
        f"x=(w-text_w)/2:y={caption_y}"
    )
    if scene.get("subcaption"):
        sub = _escape_drawtext(scene["subcaption"])
        caption_draw += (
            f",drawtext=fontfile='{font}':text='{sub}':fontcolor=white:fontsize=34:{box}"
            f"x=(w-text_w)/2:y={sub_y}"
        )

    out_path = workdir / f"scene_{index:02d}.mp4"

    if scene["image"] is None:
        video_in = ["-f", "lavfi", "-i", f"color=c={BRAND_BG}:s={WIDTH}x{HEIGHT}:d={scene_seconds}:rate={FPS}"]
        video_filter = f"[0:v]{caption_draw}[v]"
    else:
        image_path = IMG_DIR / scene["image"]
        if not image_path.exists():
            sys.exit(f"Missing screenshot: {image_path}")
        video_in = ["-loop", "1", "-i", str(image_path)]
        video_filter = (
            f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,"
            f"crop={WIDTH}:{HEIGHT},"
            f"zoompan=z='min(zoom+0.0006,1.08)':d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"format=yuv420p,{caption_draw}[v]"
        )

    cmd = [
        "ffmpeg", "-y",
        *video_in,
        "-i", str(narration_path),
        "-filter_complex", f"{video_filter};[1:a]apad[aout]",
        "-map", "[v]", "-map", "[aout]",
        "-t", f"{scene_seconds}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-ar", "44100",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def concat_scenes(scene_paths: list[Path], workdir: Path, out_path: Path) -> None:
    list_path = workdir / "concat_list.txt"
    list_path.write_text("".join(f"file '{p}'\n" for p in scene_paths))
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(list_path), "-c", "copy", str(out_path)],
        check=True, capture_output=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--voice", default="Samantha", help="macOS `say` voice (see `say -v ?` for options)")
    parser.add_argument("--out", default=str(REPO_ROOT / "freeleaf_promo.mp4"), help="output .mp4 path")
    parser.add_argument("--dry-run", action="store_true", help="print the scene plan and exit, no rendering")
    args = parser.parse_args()

    if args.dry_run:
        total = 0.0
        for i, scene in enumerate(SCENES):
            print(f"[{i:02d}] image={scene['image'] or '(title card)'!r}")
            print(f"     caption:   {scene['caption']}")
            print(f"     narration: {scene['narration']}")
        print(f"\n{len(SCENES)} scenes. Run without --dry-run to render {args.out}.")
        return

    _check_tools()
    font = _find_font()

    with tempfile.TemporaryDirectory(prefix="freeleaf_promo_") as tmp:
        workdir = Path(tmp)
        scene_paths = []
        for i, scene in enumerate(SCENES):
            print(f"Rendering scene {i + 1}/{len(SCENES)}: {scene['caption']}...")
            scene_paths.append(render_scene(scene, i, workdir, args.voice, font))

        print("Concatenating scenes...")
        out_path = Path(args.out)
        concat_scenes(scene_paths, workdir, out_path)

    print(f"Done: {out_path}")


if __name__ == "__main__":
    main()
