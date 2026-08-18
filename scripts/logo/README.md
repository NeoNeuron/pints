# Regenerating the logo files

`build_logo.py` writes two files, and neither is hand-edited:

| File | Contents | Used by |
| --- | --- | --- |
| `assets/pints-2026-header.svg` | wordmark, subtitle, date and venue | the home hero |
| `assets/pints-mark.svg` | wordmark alone | the header brand link on every page |

Same artwork, two crops, so the two cannot drift apart. This is a one-off asset
tool — deliberately **not** wired into `package.json`, and nothing on the site
depends on it at runtime. The site still has no build step.

## Why the text is outlined

`pints-2025-header-source.svg` is the Inkscape file from the 2025 edition (logo by
majab.com). It draws the wordmark, subtitle and date as `<text>` in Trebuchet MS.
A browser without that font — most Linux and Android — falls back to its default
serif, and the logo breaks badly: the wordmark turns into Times and the pint-glass
"i" lands on top of the N. So the text is shaped here and emitted as `<path>`
outlines. Only the two icon paths (glass and brain) are copied across untouched.

Two details were recovered by measuring the designer's own export
(`pints_header_2025.png`, 980×205) rather than trusting the source file, because
Inkscape and browsers disagree about it:

- The subtitle's grey runs carry **no** `font-family` or `font-size` in the source,
  so a browser renders them in 16px serif. The export shows 12.5px Trebuchet,
  matching the bold capitals.
- The wordmark run carries `dx="0 -1.295"`, which the export ignores. Applying it
  puts `NTS` 3px left of where the logo has always been.

With those two fixed the output matches the 2025 export to within 2px across its
980px width, all of it rasterizer noise.

Each file also crops its `viewBox` to its own ink plus two units. The source
frames the artwork on a page-sized canvas, and left uncropped that dead margin
reads as the logo being indented against whatever sits beside or below it.

## Running it

Needs macOS (for `/System/Library/Fonts/Supplemental/Trebuchet MS*.ttf`) and a
throwaway virtualenv:

    python3 -m venv /tmp/logo-venv
    /tmp/logo-venv/bin/pip install fonttools uharfbuzz
    cd scripts/logo && /tmp/logo-venv/bin/python build_logo.py

Edit the `DATE`, `BRAIN` and `SUBTITLE` constants at the top of `build_logo.py`
for a new edition, then update the `alt` text on the hero image in `index.html`
to match — it is the only place the date is spelled out for screen readers.

After changing anything, check the output is still valid XML (`xmllint --noout
assets/*.svg` — a `--` inside an SVG comment is illegal and browsers will not
tell you) and that nothing is clipped: render each file into a canvas and confirm
there are still a few blank pixels on every side.
