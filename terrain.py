"""Imaginary islands, drawn as topographic plates.

Everything here is pure Python and deterministic: the same seed and palette
always give the same SVG, so the web page can redraw any plate a job made
without storing it.
"""

import base64
import math
import random
import struct
import zlib

W, H = 132, 88          # the height grid
SEA = 0.30              # sea level, as a fraction of the height range
PALETTES = {
    #          paper      ink        water      low land → high land
    "ink":   ("#f4efe4", "#2b2a26", "#dde5e3", ("#efe7d6", "#d6c6a6")),
    "moss":  ("#f1efe6", "#2d3a2b", "#d3e0dd", ("#e7ead5", "#b4c197")),
    "dusk":  ("#efedf2", "#2b2944", "#d7dbea", ("#ece5ec", "#c4adc3")),
    "ember": ("#f6eee4", "#4a2a1d", "#e0e3de", ("#f2e3cf", "#d6a27f")),
}


def _noise(rng):
    """A value-noise function on a 64-cell lattice, smoothly interpolated."""
    n = 64
    lattice = [[rng.random() for _ in range(n)] for _ in range(n)]

    def at(x, y):
        x0, y0 = int(math.floor(x)), int(math.floor(y))
        fx, fy = x - x0, y - y0
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = lattice[y0 % n][x0 % n]
        b = lattice[y0 % n][(x0 + 1) % n]
        c = lattice[(y0 + 1) % n][x0 % n]
        d = lattice[(y0 + 1) % n][(x0 + 1) % n]
        return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy

    return at


def heightmap(seed):
    """An island: fractal noise under a soft, off-centre falloff."""
    rng = random.Random(seed)
    noise = _noise(rng)
    ox, oy = rng.uniform(0, 64), rng.uniform(0, 64)
    cx, cy = rng.uniform(0.42, 0.58), rng.uniform(0.42, 0.58)
    grid = []
    for j in range(H):
        row = []
        for i in range(W):
            x, y = i / W, j / H
            v, amp, freq = 0.0, 1.0, 3.2
            for _ in range(5):
                v += amp * noise(ox + x * freq * 1.5, oy + y * freq)
                amp, freq = amp * 0.5, freq * 2.0
            dx, dy = (x - cx) * 1.25, (y - cy) * 1.6
            fall = max(0.0, 1.0 - math.sqrt(dx * dx + dy * dy) * 1.55)
            row.append(v / 1.94 * (0.35 + 0.65 * fall) + fall * 0.25)
        grid.append(row)
    lo = min(min(r) for r in grid)
    hi = max(max(r) for r in grid)
    return [[(v - lo) / (hi - lo) for v in r] for r in grid]


def levels(detail):
    """The contour heights: the coastline, then `detail` steps to the top."""
    return [SEA + (1 - SEA) * k / (detail + 1) for k in range(detail + 1)]


def trace(grid, level):
    """Marching squares at one height, joined into smoothed polylines."""
    segs = []
    for j in range(H - 1):
        for i in range(W - 1):
            a, b = grid[j][i], grid[j][i + 1]
            c, d = grid[j + 1][i + 1], grid[j + 1][i]
            pts = []
            for (x0, y0, v0), (x1, y1, v1) in (
                ((i, j, a), (i + 1, j, b)),
                ((i + 1, j, b), (i + 1, j + 1, c)),
                ((i + 1, j + 1, c), (i, j + 1, d)),
                ((i, j + 1, d), (i, j, a)),
            ):
                if (v0 < level) != (v1 < level):
                    t = (level - v0) / (v1 - v0)
                    pts.append((round(x0 + (x1 - x0) * t, 3), round(y0 + (y1 - y0) * t, 3)))
            if len(pts) == 2:
                segs.append((pts[0], pts[1]))
            elif len(pts) == 4:
                segs.append((pts[0], pts[1]))
                segs.append((pts[2], pts[3]))
    return _chain(segs)


def _chain(segs):
    ends = {}
    for k, (p, q) in enumerate(segs):
        ends.setdefault(p, []).append(k)
        ends.setdefault(q, []).append(k)
    used = [False] * len(segs)
    lines = []
    for k in range(len(segs)):
        if used[k]:
            continue
        used[k] = True
        line = list(segs[k])
        for forward in (True, False):
            while True:
                tip = line[-1] if forward else line[0]
                nxt = next((m for m in ends.get(tip, ()) if not used[m]), None)
                if nxt is None:
                    break
                used[nxt] = True
                p, q = segs[nxt]
                other = q if p == tip else p
                if forward:
                    line.append(other)
                else:
                    line.insert(0, other)
        if len(line) > 3:
            lines.append(_smooth(line))
    return lines


def _smooth(line):
    closed = line[0] == line[-1]
    out = [line[0]] if not closed else []
    for (x0, y0), (x1, y1) in zip(line, line[1:]):
        out.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
        out.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
    out.append(out[0] if closed else line[-1])
    return out


def _hex(c):
    return tuple(int(c[k:k + 2], 16) for k in (1, 3, 5))


def _png_tint(grid, palette, detail, scale=3):
    """The bands as a small indexed PNG, which the SVG scales up underneath."""
    _, _, water, (low, high) = PALETTES[palette]
    lv = levels(detail)
    lo, hi = _hex(low), _hex(high)
    colors = [_hex(water)] + [
        tuple(round(lo[c] + (hi[c] - lo[c]) * k / max(1, detail)) for c in range(3))
        for k in range(detail + 1)
    ]
    w, h = (W - 1) * scale, (H - 1) * scale
    rows = []
    for y in range(h):
        gy = y / scale
        j = int(gy)
        fy = gy - j
        row = bytearray([0])
        for x in range(w):
            gx = x / scale
            i = int(gx)
            fx = gx - i
            v = (grid[j][i] * (1 - fx) + grid[j][i + 1] * fx) * (1 - fy) + (
                grid[j + 1][i] * (1 - fx) + grid[j + 1][i + 1] * fx) * fy
            band = 0
            while band < len(lv) and v >= lv[band]:
                band += 1
            row.append(band)
        rows.append(bytes(row))

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 3, 0, 0, 0))
    png += chunk(b"PLTE", b"".join(bytes(c) for c in colors))
    png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += chunk(b"IEND", b"")
    return base64.b64encode(png).decode()


def place_facts(seed, grid):
    """The things a plate prints about its island."""
    rng = random.Random(seed * 7919)
    peak = max(((v, i, j) for j, r in enumerate(grid) for i, v in enumerate(r)))
    land = sum(1 for r in grid for v in r if v >= SEA) / (W * H)
    lat = rng.uniform(-58, 64)
    lon = rng.uniform(-170, 170)
    return {
        "peak_m": int(380 + (peak[0] - SEA) / (1 - SEA) * rng.uniform(1600, 3400)),
        "peak_at": (peak[1], peak[2]),
        "land_pct": round(land * 100),
        "lat": lat,
        "lon": lon,
    }


def _coord(v, pos, neg):
    d = abs(v)
    return f"{int(d)}°{int((d % 1) * 60):02d}′{pos if v >= 0 else neg}"


def render(seed, name, palette="ink", detail=12, on_level=None):
    """The whole plate as an SVG string.

    `on_level(k, total)` is called as each contour is traced, which is what the
    render job turns into its progress bar.
    """
    palette = palette if palette in PALETTES else "ink"
    paper, ink, water, _ = PALETTES[palette]
    grid = heightmap(seed)
    facts = place_facts(seed, grid)
    lv = levels(detail)

    VW, VH = 1200, 860
    mx, my, mw, mh = 64, 64, 1072, 656       # the map frame
    sx, sy = mw / (W - 1), mh / (H - 1)

    def path(line):
        return "M" + " L".join(f"{mx + x * sx:.1f},{my + y * sy:.1f}" for x, y in line)

    parts = []
    for k, step in enumerate((0.018, 0.04, 0.07)):
        lines = trace(grid, SEA - step)
        if lines:
            d = " ".join(path(line) for line in lines)
            parts.append(
                f'<path d="{d}" fill="none" stroke="{ink}" stroke-width="0.5" '
                f'stroke-opacity="{0.32 - k * 0.09:.2f}" stroke-linejoin="round"/>'
            )
    for k, level in enumerate(lv):
        lines = trace(grid, level)
        if on_level:
            on_level(k + 1, len(lv))
        if not lines:
            continue
        d = " ".join(path(line) for line in lines)
        if k == 0:
            width, opacity = 1.6, 0.95
        elif k % 4 == 0:
            width, opacity = 1.05, 0.8
        else:
            width, opacity = 0.55, 0.55
        parts.append(
            f'<path d="{d}" fill="none" stroke="{ink}" stroke-width="{width}" '
            f'stroke-opacity="{opacity}" stroke-linejoin="round" stroke-linecap="round"/>'
        )

    tint = _png_tint(grid, palette, detail)
    px, py = facts["peak_at"]
    peak_x, peak_y = mx + px * sx, my + py * sy

    ticks = []
    for t in range(1, 8):
        x = mx + mw * t / 8
        ticks.append(f'<line x1="{x:.1f}" y1="{my}" x2="{x:.1f}" y2="{my - 7}"/>')
        ticks.append(f'<line x1="{x:.1f}" y1="{my + mh}" x2="{x:.1f}" y2="{my + mh + 7}"/>')
    for t in range(1, 6):
        y = my + mh * t / 6
        ticks.append(f'<line x1="{mx}" y1="{y:.1f}" x2="{mx - 7}" y2="{y:.1f}"/>')
        ticks.append(f'<line x1="{mx + mw}" y1="{y:.1f}" x2="{mx + mw + 7}" y2="{y:.1f}"/>')

    lat = _coord(facts["lat"], "N", "S")
    lon = _coord(facts["lon"], "E", "W")
    title = _esc(name.upper())
    serif = "Iowan Old Style, Palatino Linotype, Palatino, Book Antiqua, Georgia, serif"
    mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {VW} {VH}" font-family="{serif}">
<rect width="{VW}" height="{VH}" fill="{paper}"/>
<rect x="{mx}" y="{my}" width="{mw}" height="{mh}" fill="{water}"/>
<image x="{mx}" y="{my}" width="{mw}" height="{mh}" preserveAspectRatio="none" href="data:image/png;base64,{tint}"/>
{''.join(parts)}
<g fill="{ink}"><path d="M{peak_x:.1f},{peak_y - 7:.1f} l6,10 h-12 z"/>
<text x="{peak_x + 10:.1f}" y="{peak_y + 3:.1f}" font-size="13" font-style="italic">{facts['peak_m']:,} m</text></g>
<rect x="{mx}" y="{my}" width="{mw}" height="{mh}" fill="none" stroke="{ink}" stroke-width="1.4"/>
<rect x="{mx - 12}" y="{my - 12}" width="{mw + 24}" height="{mh + 24}" fill="none" stroke="{ink}" stroke-width="0.6"/>
<g stroke="{ink}" stroke-width="0.8">{''.join(ticks)}</g>
<g fill="{ink}">
<text x="{mx}" y="{my + mh + 62}" font-size="34" letter-spacing="6">{title}</text>
<text x="{mx}" y="{my + mh + 92}" font-size="14" font-style="italic" opacity="0.75">{lat}  ·  {lon}  ·  {facts['land_pct']}% land  ·  contour interval {round(facts['peak_m'] / (detail + 1)):,} m</text>
<text x="{mx + mw}" y="{my + mh + 92}" font-size="12" text-anchor="end" font-family="{mono}" opacity="0.6">PLATE {seed:05d} · {palette.upper()}</text>
</g>
<g transform="translate({mx + mw - 150},{my + mh + 46})" stroke="{ink}" fill="{ink}">
<rect width="40" height="5" fill="{ink}"/><rect x="40" width="40" height="5" fill="{paper}"/>
<rect x="80" width="40" height="5" fill="{ink}"/><rect width="120" height="5" fill="none" stroke-width="0.8"/>
<text x="0" y="-6" font-size="10" stroke="none" font-family="{mono}">0</text>
<text x="120" y="-6" font-size="10" stroke="none" text-anchor="end" font-family="{mono}">12 km</text>
</g>
<g transform="translate({mx + mw - 30},{my + 36})" fill="{ink}">
<path d="M0,-22 L7,6 L0,1 L-7,6 Z"/><text y="22" font-size="13" text-anchor="middle">N</text>
</g>
</svg>"""


def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def plate_of_day(day):
    """The plate the atlas shows on a given date, and the one its schedule draws."""
    names = ["Corran", "Hesketh", "Vael", "Ormsby", "Tarn", "Lisk", "Barra", "Quill", "Eddan", "Moray"]
    kinds = ["Isle", "Holm", "Reach", "Skerry", "Fell", "Head"]
    n = day.toordinal()
    return {
        "name": f"{names[n % len(names)]} {kinds[n % len(kinds)]}",
        "seed": n % 100000,
        "palette": list(PALETTES)[n % len(PALETTES)],
        "detail": 12,
        "date": day.strftime("%-d %B %Y"),
    }


def seed_for(name):
    """A plate's seed from its name, so the same name is the same island."""
    return zlib.crc32(name.strip().lower().encode()) % 100000
