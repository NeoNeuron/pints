"""Turn the Trebuchet MS text runs of the PINTS header into outlines.

The header is used as an <img>, so any glyph it draws must not depend on the
visitor having Trebuchet MS installed. Without it a browser falls back to its
default serif: the wordmark turns into Times and the pint-glass "i" lands on
top of the N. Shaping the runs here and emitting <path> data makes the file
self-contained.
"""
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

FONTS = {
    "regular": "/System/Library/Fonts/Supplemental/Trebuchet MS.ttf",
    "bold": "/System/Library/Fonts/Supplemental/Trebuchet MS Bold.ttf",
}

_cache = {}


def _load(weight):
    if weight not in _cache:
        path = FONTS[weight]
        tt = TTFont(path)
        face = hb.Face(hb.Blob.from_file_path(path))
        font = hb.Font(face)
        upem = tt["head"].unitsPerEm
        font.scale = (upem, upem)
        _cache[weight] = (tt, font, tt.getGlyphSet(), tt.getGlyphOrder(), upem)
    return _cache[weight]


def shape(text, weight):
    """[(glyph_name, x_offset, y_offset)], total_advance — all in font units."""
    tt, font, _glyphs, order, _upem = _load(weight)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf)
    out, pen_x = [], 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((order[info.codepoint], pen_x + pos.x_offset, pos.y_offset))
        pen_x += pos.x_advance
    return out, pen_x


def run_path(text, weight, size, x=0.0, y=0.0, anchor="start", dx=()):
    """SVG path data for one styled run, in the coordinate space of its <text>.

    `dx` is SVG's per-character shift and is cumulative, matching how the
    source file nudges the gap that the pint glass sits in.
    """
    tt, _font, glyph_set, _order, upem = _load(weight)
    placed, advance = shape(text, weight)
    scale = size / upem
    start = x - advance * scale if anchor == "end" else x
    sink = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.3f}".rstrip("0").rstrip("."))
    shift = 0.0
    for i, (name, gx, gy) in enumerate(placed):
        if i < len(dx):
            shift += dx[i]
        # Fonts are y-up, SVG is y-down, hence the negative y scale.
        t = Transform(scale, 0, 0, -scale, start + gx * scale + shift, y - gy * scale)
        glyph_set[name].draw(TransformPen(sink, t))
    return sink.getCommands(), advance * scale


def width(text, weight, size):
    _tt, _font, _gs, _order, upem = _load(weight)
    return shape(text, weight)[1] * size / upem
