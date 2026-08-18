"""Build the two PINTS logo files from the 2025 Inkscape source.

  assets/pints-2026-header.svg   wordmark + subtitle + date, for the home hero
  assets/pints-mark.svg          wordmark alone, for the header brand link

Three things change from 2025: the date line, the brain colour, and the text —
which becomes outlines. The two icon paths (pint glass and brain) are lifted
from the source verbatim, transforms and clip-paths included, so the artwork
itself is untouched.
"""
import re
from pathlib import Path

import textpaths as tp

HERE = Path(__file__).parent
ASSETS = HERE / ".." / ".." / "assets"

# The brain on the "i" is the one recolour, and it tracks --accent in
# css/styles.css: it sits directly above the hero's buttons, so any other hue
# reads as a second accent colour rather than as part of the same identity.
# Keep the two in step by hand -- an SVG cannot read a CSS custom property,
# and inlining the mark to make it themeable would put a 46KB blob in every
# page just to share one hex value.
BRAIN = "#7b1e3a"
# The subtitle's lower case and the three date lines. This tracks --muted in
# css/styles.css, and it is a legibility fix rather than a style choice: the
# designer's #808080 clears only 3.3:1 against the hero's --accent-soft band,
# under the 4.5:1 small text is meant to meet, and the band now carries
# photographs behind it which take it lower still. #5c5c5c is the grey the rest
# of the site already uses for secondary text, and clears 7:1 on the bare band.
GREY = "#5c5c5c"
DATE = ["November 6th, 2026", "Daniel Cohen Amphitheater, ENS", "48 Bd Jourdan, 75014 Paris"]

# Sizes measured back off the designer's own export (pints_header_2025.png):
# the wordmark and date carry explicit sizes in the source, but the subtitle's
# grey runs inherit theirs, and 12.5 is what Inkscape actually rendered.
SUBTITLE_SIZE = 12.5
DATE_SIZE = 11
DATE_LEADING = 13.804416
DATE_ANCHOR_X = 196.64062

SUBTITLE = [
    ("P", "bold", None), ("aris", "regular", GREY),
    (" Î", "bold", None), ("le-de-France", "regular", GREY),
    (" N", "bold", None), ("euroscience, ", "regular", GREY),
    ("T", "bold", None), ("heory, and ", "regular", GREY),
    ("S", "bold", None), ("ystems", "regular", GREY),
]

# The 2025 source frames the artwork inside a page-sized canvas, leaving ~5% dead
# space on the left and ~8% on top. Placed in the hero that reads as the logo
# being indented against the buttons below, so each file crops its viewBox to its
# own ink plus two units of breathing room and lets the page own the spacing.
# Bounds come from measuring a 980px-wide render and converting at 566.70935/980:
# the full logo's ink spans x 47..943 / y 9..187, the mark's x 51..491 / y 9..130.
HEADER_VIEWBOX = (25.2, 3.2, 522.2, 107.0)
MARK_VIEWBOX = (27.5, 3.2, 258.5, 74.0)

src = (HERE / "pints-2025-header-source.svg").read_text(encoding="utf-8")
icon = {}
for pid in ("path33", "path35"):
    icon[pid] = re.search(r'<path\s+id="%s".*?/>' % pid, src, re.S).group(0)
# The brain is the only recolour.
icon["path33"] = icon["path33"].replace("fill:#ff00ff", f"fill:{BRAIN}")
assert BRAIN in icon["path33"]
# Reindent the lifted fragments to sit at one level inside <g>.
for k, v in icon.items():
    icon[k] = "\n".join("    " + ln.strip() for ln in v.splitlines())

# --- wordmark: "P  NTS", the double space is the slot the pint glass sits in.
# The source carries dx="0 -1.295" on this run, but Inkscape's own export ignores
# it -- with the nudge applied, NTS lands 3px left of pints_header_2025.png. The
# export is the logo everyone has seen, so match that and drop the dx.
wordmark, _ = tp.run_path("P  NTS", "regular", 70)

# --- subtitle: one path per colour, so the file stays two paths not ten.
groups = {"#000000": [], GREY: []}
x = 0.0
for text, weight, fill in SUBTITLE:
    d, adv = tp.run_path(text, weight, SUBTITLE_SIZE, x=x)
    groups[fill or "#000000"].append(d)
    x += adv

# --- date block: right-aligned, three lines.
date_paths = "".join(
    tp.run_path(line, "regular", DATE_SIZE, x=DATE_ANCHOR_X, y=i * DATE_LEADING, anchor="end")[0]
    for i, line in enumerate(DATE)
)

# Only clipPath37 (on the wordmark) and 34/36 (on the two icon paths) are still
# referenced; the source's other defs went with the empty text elements.
DEFS = '''  <defs>
    <clipPath clipPathUnits="userSpaceOnUse" id="clipPath34">
      <path d="M 0,88.723 H 425.032 V 0 H 0 Z" transform="translate(-87.542805,-69.094001)" />
    </clipPath>
    <clipPath clipPathUnits="userSpaceOnUse" id="clipPath36">
      <path d="M 0,88.723 H 425.032 V 0 H 0 Z" transform="translate(-64.579904,-57.534701)" />
    </clipPath>
    <clipPath clipPathUnits="userSpaceOnUse" id="clipPath37">
      <path d="M 0,88.723 H 425.032 V 0 H 0 Z" transform="matrix(1,0,0,-1,-16.973098,33.132301)" />
    </clipPath>
  </defs>'''

WORDMARK_GROUP = f'''{icon["path33"]}
{icon["path35"]}
    <g id="wordmark" transform="matrix(1.3333333,0,0,1.3333333,609.34013,74.1204)"
       clip-path="url(#clipPath37)">
      <path fill="#000000" d="{wordmark}" />
    </g>'''


def build(viewbox, label, title, body):
    vx, vy, vw, vh = viewbox
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/logo/build_logo.py; do not hand-edit.
     Derived from the 2025 logo by majab.com. The text is Trebuchet MS converted
     to outlines so the file does not depend on the visitor having that font. -->
<svg xmlns="http://www.w3.org/2000/svg" version="1.1"
   width="{vw}" height="{vh}" viewBox="{vx} {vy} {vw} {vh}"
   role="img" aria-label="{label}">
  <title>{title}</title>
{DEFS}
  <g transform="translate(-586.70935)">
{body}
  </g>
</svg>
'''


header = build(
    HEADER_VIEWBOX, "PINTS 2026",
    "PINTS 2026 — Paris Île-de-France Neuroscience, Theory, and Systems",
    f'''{WORDMARK_GROUP}
    <g id="subtitle" transform="matrix(1.3333333,0,0,1.3333333,612.6208,105.356)">
      <path fill="#000000" d="{"".join(groups["#000000"])}" />
      <path fill="{GREY}" d="{"".join(groups[GREY])}" />
    </g>
    <g id="dateline" transform="matrix(1.3333333,0,0,1.3333333,871.08742,28.912236)">
      <path fill="{GREY}" d="{date_paths}" />
    </g>''')

mark = build(MARK_VIEWBOX, "PINTS", "PINTS", WORDMARK_GROUP)

for name, text in (("pints-2026-header.svg", header), ("pints-mark.svg", mark)):
    (ASSETS / name).write_text(text, encoding="utf-8")
    print(f"wrote assets/{name} ({len(text)} bytes)")
