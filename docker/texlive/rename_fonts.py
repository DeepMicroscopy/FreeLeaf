#!/usr/bin/env python3
"""Generates copies of the metric-compatible open-source substitute fonts
with their own internal name-table records rewritten to the proprietary
Microsoft Office font name they stand in for (Arial, Times New Roman, etc.)

Why this exists, and why fontconfig config alone wasn't enough: see
fontconfig-aliases.conf's comment — `<alias>`/`<accept>` and even a
`target="pattern"`/`target="scan"` `<match>` all left `fc-match`/`fc-list`
correctly resolving "Arial" to Arimo, yet XeTeX's own internal font manager
(fontspec/XeTeXFontMgr_FC) still failed to find it — it evidently indexes
fonts by only the font's own *primary* declared family name, not any
fontconfig-level alias/rewrite layered on top. Actually renaming a copy of
the font file's own metadata is the only fix that's guaranteed to work
regardless of which lookup mechanism a given tool uses, since the font
itself unambiguously claims the alias name.
"""

import os

from fontTools.ttLib import TTFont

RENAMES = {
    "Arimo": "Arial",
    "Tinos": "Times New Roman",
    "Cousine": "Courier New",
    "Carlito": "Calibri",
    "Caladea": "Cambria",
}
SRC_DIRS = ["/usr/share/fonts/truetype/croscore", "/usr/share/fonts/truetype/crosextra"]
OUT_DIR = "/usr/local/share/fonts/aliased"


def style_suffix(filename: str, family: str) -> str:
    return filename[len(family) : -len(".ttf")].lstrip("-") or "Regular"


def subfamily_for(style: str) -> str:
    is_bold = "Bold" in style
    is_italic = "Italic" in style
    if is_bold and is_italic:
        return "Bold Italic"
    if is_bold:
        return "Bold"
    if is_italic:
        return "Italic"
    return "Regular"


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for src_dir in SRC_DIRS:
        for filename in sorted(os.listdir(src_dir)):
            if not filename.endswith(".ttf"):
                continue
            family = next((f for f in RENAMES if filename.startswith(f)), None)
            if family is None:
                continue
            new_family = RENAMES[family]
            style = style_suffix(filename, family)
            subfamily = subfamily_for(style)

            font = TTFont(os.path.join(src_dir, filename))
            name_table = font["name"]
            full_name = new_family if subfamily == "Regular" else f"{new_family} {subfamily}"
            ps_name = f"{new_family.replace(' ', '')}-{subfamily.replace(' ', '')}"
            for record in name_table.names:
                if record.nameID == 1:
                    record.string = new_family
                elif record.nameID == 4:
                    record.string = full_name
                elif record.nameID == 6:
                    record.string = ps_name
                elif record.nameID == 16:
                    record.string = new_family

            out_path = os.path.join(OUT_DIR, f"{new_family.replace(' ', '')}-{style}.ttf")
            font.save(out_path)
            print(f"wrote {out_path} (family={new_family!r} subfamily={subfamily!r})")


if __name__ == "__main__":
    main()
