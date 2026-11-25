"""Renders signed-distance-field glyphs that match God of War's SMF3 fonts.

Usage: py -3 -I glyphs.py <job.json> <out.json>
job = {
  "font": "path/to/font.ttf",       # any TrueType/OpenType font with the characters
  "capHeight": 43.6,                # the game font's 'H' height in atlas pixels (from its SMF)
  "chars": "אב...",                 # characters to render
  "axes": {"wght": 600},            # optional, for variable fonts
  "weight": 0.0,                    # px added to the stroke on each side (thicken a thin font)
  "slope": 17.0,                    # SDF value change per pixel (game: ~17, edge at 128)
  "pad": 8                          # empty pixels around the ink for the distance halo
}
out = {"glyphs": [{cp, w, h, data (base64, w*h bytes), inkX, inkY, left, right, top, bottom, advance}]}
left/right are ink edges from the pen, top/bottom from the baseline (up = positive), in pixels;
inkX/inkY = where the ink box starts inside the bitmap. Needs Pillow and numpy.
"""
import base64
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

SS = 8  # supersampling


def load_font(font_path, size, axes=None):
    font = ImageFont.truetype(font_path, size)
    if axes:
        names = [a['name'].decode() if isinstance(a['name'], bytes) else a['name'] for a in font.get_variation_axes()]
        tags = {'Weight': 'wght', 'Width': 'wdth'}
        values = []
        for a, n in zip(font.get_variation_axes(), names):
            values.append(axes.get(tags.get(n, n), a['default']))
        font.set_variation_by_axes(values)
    return font


def em_for_cap(font_path, cap_height, axes=None):
    probe = load_font(font_path, 400, axes)
    im = Image.new('L', (800, 800))
    ImageDraw.Draw(im).text((100, 600), 'H', font=probe, fill=255, anchor='ls')
    bb = im.getbbox()
    return cap_height / ((bb[3] - bb[1]) / 400.0)


def boundary_points(mask):
    """Centers of inside pixels that touch an outside pixel (4-neighbourhood)."""
    m = mask
    edge = np.zeros_like(m)
    edge[1:, :] |= m[1:, :] != m[:-1, :]
    edge[:-1, :] |= m[:-1, :] != m[1:, :]
    edge[:, 1:] |= m[:, 1:] != m[:, :-1]
    edge[:, :-1] |= m[:, :-1] != m[:, 1:]
    ys, xs = np.nonzero(edge & m)
    return np.stack([xs + 0.5, ys + 0.5], axis=1)


def render(font_path, em, ch, weight, slope, pad, axes=None):
    font = load_font(font_path, em * SS, axes)
    advance = font.getlength(ch) / SS
    size = int(em * SS * 3)
    ox, oy = size // 3, size * 2 // 3
    im = Image.new('L', (size, size))
    ImageDraw.Draw(im).text((ox, oy), ch, font=font, fill=255, anchor='ls')
    mask = np.array(im) >= 128
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    left, right = (xs.min() - ox) / SS, (xs.max() + 1 - ox) / SS
    top, bottom = (oy - ys.min()) / SS, (oy - ys.max() - 1) / SS
    grow = max(0.0, weight)
    x0 = math.floor(left - grow) - pad
    x1 = math.ceil(right + grow) + pad
    ytop = math.ceil(top + grow) + pad
    ybot = math.floor(bottom - grow) - pad
    w, h = x1 - x0, ytop - ybot

    pts = boundary_points(mask)
    cx = (np.arange(w) + x0 + 0.5) * SS + ox
    cy = oy - (ytop - np.arange(h) - 0.5) * SS
    gx, gy = np.meshgrid(cx, cy)
    q = np.stack([gx.ravel(), gy.ravel()], axis=1)
    best = np.full(len(q), np.inf)
    for i in range(0, len(pts), 2048):
        p = pts[i:i + 2048]
        d = ((q[:, None, 0] - p[None, :, 0]) ** 2 + (q[:, None, 1] - p[None, :, 1]) ** 2).min(axis=1)
        best = np.minimum(best, d)
    dist = np.sqrt(best) / SS
    qi = np.clip(q.astype(int), 0, size - 1)
    inside = mask[qi[:, 1], qi[:, 0]]
    signed = np.where(inside, dist, -dist) + weight
    val = np.clip(np.round(128 + slope * signed), 0, 255).astype(np.uint8).reshape(h, w)
    return {
        'w': int(w), 'h': int(h),
        'data': base64.b64encode(val.tobytes()).decode('ascii'),
        'inkX': left - weight - x0, 'inkY': ytop - (top + weight),
        'left': left - weight, 'right': right + weight, 'top': top + weight, 'bottom': bottom - weight,
        'advance': advance + 2 * weight,
    }


def main():
    job = json.load(open(sys.argv[1], encoding='utf-8'))
    em = em_for_cap(job['font'], job['capHeight'], job.get('axes'))
    out = []
    for ch in job['chars']:
        g = render(job['font'], em, ch, job.get('weight', 0.0), job.get('slope', 17.0), job.get('pad', 8), job.get('axes'))
        if g:
            g['cp'] = ord(ch)
            out.append(g)
    json.dump({'em': em, 'glyphs': out}, open(sys.argv[2], 'w', encoding='utf-8'))
    print(f"{len(out)} glyphs at em {em:.1f}px")


if __name__ == '__main__':
    main()
