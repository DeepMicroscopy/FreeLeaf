#!/usr/bin/env python3
"""Generates a short, silent (music-only) promo video for FreeLeaf, for
sharing on LinkedIn.

Assembles the real screenshots under docs/assets/img into a sequence of
scenes — a title card, one scene per claim (digital sovereignty,
collaboration, citations, comments, review modes, table designer,
compile/SyncTeX, version history, sign-in), and an outro/CTA card — crossfaded
into each other with a different transition each time, each with its own
Ken-Burns pan/zoom and animated (fade-and-slide) on-screen text carrying the
whole message, since there's no narration. A soft procedural ambient bed
(a few detuned sine tones, no spoken words, no bundled/downloaded audio)
plays underneath at low volume.

Requirements (all local, no API keys/network calls, no bundled audio assets):
  - ffmpeg (with libx264/aac and the xfade/tremolo/lowpass filters — all
    present in any reasonably recent build; on macOS: `brew install ffmpeg`)

Usage:
    python3 scripts/make_promo_video.py
    python3 scripts/make_promo_video.py --out freeleaf_promo.mp4
    python3 scripts/make_promo_video.py --dry-run   # print the scene plan, do nothing

Output is a 1920x1080 H.264+AAC MP4, ~37s with the default scenes, suitable
for a LinkedIn post.
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
TRANSITION_SECONDS = 0.6
MUSIC_VOLUME = 0.16

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]

# A different crossfade style each time so consecutive scenes don't all cut
# the same way — this is the main thing that makes it read as "edited," not
# a slideshow with a single dissolve reused ten times.
TRANSITIONS = [
    "fade", "wipeleft", "slideup", "circleopen", "smoothleft",
    "diagtl", "pixelize", "coverup", "wiperight", "slideright",
]

# Each scene: image is None for a solid-color title/outro card. `caption` is
# the on-screen headline; `subcaption` (optional) is a shorter supporting
# line — together they have to carry the whole message, since the video
# has no narration. `pan` picks the Ken Burns move (see build_scene_filter).
SCENES = [
    {
        "image": None,
        "caption": "FreeLeaf",
        "subcaption": "Open source. Self-hosted. Yours.",
        "seconds": 3.2,
    },
    {
        "image": "hero-workspace.png",
        "caption": "Digital sovereignty",
        "subcaption": "Your documents, your servers, your rules",
        "pan": "zoom-in",
        "seconds": 4.2,
    },
    {
        "image": "collab-merged-compile.png",
        "caption": "Real-time collaboration",
        "subcaption": "Live edits, merged automatically — even offline ones",
        "pan": "pan-right",
        "seconds": 4.0,
    },
    {
        "image": "cite-autocomplete.png",
        "caption": "Citations that autocomplete",
        "subcaption": "Paste BibTeX in, cite it with \\cite{",
        "pan": "zoom-in",
        "seconds": 4.0,
    },
    {
        "image": "comments-marked-text.png",
        "caption": "Comments on the exact text",
        "subcaption": "Anchored to the phrase, not just a line number",
        "pan": "pan-left",
        "seconds": 4.0,
    },
    {
        "image": "track-changes-markup.png",
        "caption": "Review & track changes",
        "subcaption": "Word-level, color-coded per author",
        "pan": "zoom-in",
        "seconds": 4.0,
    },
    {
        "image": "table-designer-open.png",
        "caption": "Table Designer",
        "subcaption": "A spreadsheet-like grid — saved back to clean LaTeX",
        "pan": "pan-right",
        "seconds": 4.0,
    },
    {
        "image": "synctex-forward-search.png",
        "caption": "Sandboxed compiling, real SyncTeX",
        "subcaption": "Click the PDF, jump to the source — and back",
        "pan": "zoom-in",
        "seconds": 4.0,
    },
    {
        "image": "version-history-diff.png",
        "caption": "Version history",
        "subcaption": "Checkpoints, named versions, real side-by-side diffs",
        "pan": "pan-left",
        "seconds": 4.0,
    },
    {
        "image": "login-sso-picker.png",
        "caption": "Sign in your way",
        "subcaption": "ORCID, magic link, or your institution's own SSO",
        "pan": "zoom-in",
        "seconds": 4.0,
    },
    {
        "image": None,
        "caption": "Self-host it today",
        "subcaption": "Free and open source, AGPL-3.0",
        "seconds": 3.6,
    },
]


def _find_font() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    sys.exit("No usable font found — edit FONT_CANDIDATES in this script to point at one.")


def _check_tools() -> None:
    missing = [t for t in ("ffmpeg", "ffprobe") if shutil.which(t) is None]
    if missing:
        sys.exit(f"Missing required tool(s): {', '.join(missing)}. Install with `brew install ffmpeg`.")


def _escape_drawtext(text: str) -> str:
    # ffmpeg drawtext treats : \ ' and % as special inside the filter string.
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%")


def _animated_drawtext(font: str, text: str, fontsize: int, y_expr: str, duration: float, box: bool = True) -> str:
    """Fades the text in over 0.35s, holds it, fades out over the last 0.35s
    — `y_expr` should reference `slide` (pixels of upward entrance offset,
    already computed) rather than a bare number."""
    escaped = _escape_drawtext(text)
    fade = 0.35
    alpha = (
        f"if(lt(t,{fade}),t/{fade},"
        f"if(gt(t,{duration - fade}),max(0,({duration}-t)/{fade}),1))"
    )
    slide = f"(if(lt(t,{fade}),(1-t/{fade})*18,0))"
    box_part = "box=1:boxcolor=black@0.5:boxborderw=16:" if box else ""
    y = y_expr.replace("SLIDE", slide)
    return f"drawtext=fontfile='{font}':text='{escaped}':fontcolor=white:fontsize={fontsize}:{box_part}alpha='{alpha}':x=(w-text_w)/2:y='{y}'"


def build_scene_filter(scene: dict, font: str, duration: float) -> str:
    frames = round(duration * FPS)
    is_card = scene["image"] is None

    if is_card:
        caption_y = "(h/2)-70+SLIDE" if scene.get("subcaption") else "(h-text_h)/2+SLIDE"
        sub_y = "(h/2)+20+SLIDE"
        base = ""
    else:
        pan = scene.get("pan", "zoom-in")
        if pan == "zoom-in":
            zoom_expr = "zoompan=z='min(zoom+0.0007,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        elif pan == "pan-right":
            zoom_expr = "zoompan=z='1.08':x='(iw-iw/zoom)*(on/{f})':y='ih/2-(ih/zoom/2)'".format(f=max(frames - 1, 1))
        else:  # pan-left
            zoom_expr = "zoompan=z='1.08':x='(iw-iw/zoom)*(1-on/{f})':y='ih/2-(ih/zoom/2)'".format(f=max(frames - 1, 1))
        base = (
            f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},"
            f"{zoom_expr}:d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},format=yuv420p,"
        )
        caption_y = "h-210+SLIDE"
        sub_y = "h-135+SLIDE"

    caption_draw = _animated_drawtext(font, scene["caption"], 64, caption_y, duration)
    parts = [caption_draw]
    if scene.get("subcaption"):
        parts.append(_animated_drawtext(font, scene["subcaption"], 32, sub_y, duration))

    return base + ",".join(parts)


def render_scene(scene: dict, index: int, workdir: Path, font: str) -> Path:
    duration = scene["seconds"]
    out_path = workdir / f"scene_{index:02d}.mp4"
    video_filter = build_scene_filter(scene, font, duration)

    if scene["image"] is None:
        video_in = ["-f", "lavfi", "-i", f"color=c={BRAND_BG}:s={WIDTH}x{HEIGHT}:d={duration}:rate={FPS}"]
    else:
        image_path = IMG_DIR / scene["image"]
        if not image_path.exists():
            sys.exit(f"Missing screenshot: {image_path}")
        video_in = ["-loop", "1", "-i", str(image_path)]

    cmd = [
        "ffmpeg", "-y",
        *video_in,
        "-filter_complex", f"[0:v]{video_filter}[v]",
        "-map", "[v]",
        "-t", f"{duration}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out_path


def crossfade_concat(scene_paths: list[Path], durations: list[float], out_path: Path) -> float:
    """Chains all scene clips together with ffmpeg's `xfade`, a different
    transition style each time, each overlapping the previous clip by
    TRANSITION_SECONDS — the standard technique for crossfading N clips in
    one filter graph (each stage's `offset` is the cumulative timeline
    position minus one transition-length per xfade applied so far)."""
    inputs: list[str] = []
    for p in scene_paths:
        inputs += ["-i", str(p)]

    filter_parts = []
    prev_label = "0:v"
    cumulative = durations[0]
    for i in range(1, len(scene_paths)):
        offset = cumulative - TRANSITION_SECONDS
        out_label = f"v{i}" if i < len(scene_paths) - 1 else "vout"
        transition = TRANSITIONS[(i - 1) % len(TRANSITIONS)]
        filter_parts.append(
            f"[{prev_label}][{i}:v]xfade=transition={transition}:duration={TRANSITION_SECONDS}:offset={offset:.3f}[{out_label}]"
        )
        cumulative = cumulative + durations[i] - TRANSITION_SECONDS
        prev_label = out_label

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", ";".join(filter_parts),
        "-map", "[vout]",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return cumulative


def make_music_bed(duration: float, out_path: Path) -> None:
    """A soft, procedural ambient pad (three detuned low sine tones, slow
    tremolo, low-passed, faded in/out) — deliberately not "real" music, just
    an unobtrusive bed with no words, generated entirely by ffmpeg so this
    script never has to fetch or bundle a third-party audio file."""
    fade = min(2.0, duration / 4)
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"sine=frequency=130.81:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=164.81:duration={duration}",
        "-f", "lavfi", "-i", f"sine=frequency=196.00:duration={duration}",
        "-filter_complex",
        (
            "[0:a]volume=0.5[a0];[1:a]volume=0.35[a1];[2:a]volume=0.3[a2];"
            "[a0][a1][a2]amix=inputs=3:duration=longest,"
            "lowpass=f=900,tremolo=f=0.15:d=0.4,"
            f"afade=t=in:st=0:d={fade},afade=t=out:st={max(duration - fade, 0)}:d={fade},"
            f"volume={MUSIC_VOLUME}[aout]"
        ),
        "-map", "[aout]",
        "-t", f"{duration}",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def mux_final(video_path: Path, audio_path: Path, out_path: Path) -> None:
    cmd = [
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-i", str(audio_path),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac",
        "-shortest",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(REPO_ROOT / "freeleaf_promo.mp4"), help="output .mp4 path")
    parser.add_argument("--dry-run", action="store_true", help="print the scene plan and exit, no rendering")
    args = parser.parse_args()

    if args.dry_run:
        total = sum(s["seconds"] for s in SCENES) - (len(SCENES) - 1) * TRANSITION_SECONDS
        for i, scene in enumerate(SCENES):
            print(f"[{i:02d}] image={scene['image'] or '(title card)'!r} seconds={scene['seconds']}")
            print(f"     caption:    {scene['caption']}")
            if scene.get("subcaption"):
                print(f"     subcaption: {scene['subcaption']}")
        print(f"\n{len(SCENES)} scenes, ~{total:.1f}s total. Run without --dry-run to render {args.out}.")
        return

    _check_tools()
    font = _find_font()

    with tempfile.TemporaryDirectory(prefix="freeleaf_promo_") as tmp:
        workdir = Path(tmp)
        scene_paths = []
        for i, scene in enumerate(SCENES):
            print(f"Rendering scene {i + 1}/{len(SCENES)}: {scene['caption']}...")
            scene_paths.append(render_scene(scene, i, workdir, font))

        print("Crossfading scenes together...")
        durations = [s["seconds"] for s in SCENES]
        silent_video = workdir / "silent.mp4"
        total_duration = crossfade_concat(scene_paths, durations, silent_video)

        print("Generating background music bed...")
        music_path = workdir / "music.wav"
        make_music_bed(total_duration, music_path)

        print("Muxing final video...")
        out_path = Path(args.out)
        mux_final(silent_video, music_path, out_path)

    print(f"Done: {out_path}")


if __name__ == "__main__":
    main()
