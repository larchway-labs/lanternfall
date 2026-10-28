"""A walled medieval town, laid out from a seed.

The same name, size and season always give the same town, so the game can
rebuild any town a `found` run laid out without storing it. Coordinates are
metres, the market square is at the origin, and +z is south.
"""

import math
import random
import zlib

SIZES = {"hamlet": 40, "village": 52, "town": 64, "city": 78}
SEASONS = ("spring", "summer", "autumn", "winter")
LANTERNS = {"hamlet": 5, "village": 6, "town": 8, "city": 10}

FIRST = ["Aldric", "Bertil", "Cedric", "Edda", "Gisela", "Hamond", "Isolde", "Jory",
         "Maud", "Osric", "Rowena", "Tobin", "Wynne", "Agnes", "Godric", "Elspeth"]
PLACE_A = ["Ash", "Bram", "Cold", "Elder", "Fen", "Glen", "Hart", "Kings", "Mill",
           "Oak", "Raven", "Stone", "Thorn", "Wether", "Wolf", "Yarrow"]
PLACE_B = ["bury", "ford", "holt", "mere", "stead", "wick", "by", "combe", "dale", "hythe"]


def seed_for(name):
    return zlib.crc32(name.strip().lower().encode()) % 100000


def town_of_the_day(day):
    """The town the game opens on for a date, and the one its schedule founds."""
    n = day.toordinal()
    return {
        "name": PLACE_A[n % len(PLACE_A)] + PLACE_B[(n // 3) % len(PLACE_B)],
        "seed": n % 100000,
        "size": "town",
        "season": SEASONS[((day.month - 3) % 12) // 3],
        "date": day.strftime("%-d %B %Y"),
    }


class Ground:
    """What occupies each half-metre cell: road, a building, or a reserved plot."""

    CELL = 0.5

    def __init__(self):
        self.roads = set()
        self.solid = set()

    def key(self, x, z):
        return (int(math.floor(x / self.CELL)), int(math.floor(z / self.CELL)))

    def disc(self, cells, x, z, r):
        c = self.CELL
        for i in range(int((x - r) / c) - 1, int((x + r) / c) + 2):
            for j in range(int((z - r) / c) - 1, int((z + r) / c) + 2):
                if ((i + 0.5) * c - x) ** 2 + ((j + 0.5) * c - z) ** 2 <= r * r:
                    cells.add((i, j))

    def rect(self, x, z, w, d, ry, shrink=0.0):
        cs, sn = math.cos(ry), math.sin(ry)
        out = set()
        u = -w / 2 + shrink
        while u <= w / 2 - shrink:
            v = -d / 2 + shrink
            while v <= d / 2 - shrink:
                out.add(self.key(x + u * cs + v * sn, z - u * sn + v * cs))
                v += self.CELL * 0.8
            u += self.CELL * 0.8
        return out

    def free(self, cells):
        return not (cells & self.roads or cells & self.solid)


def _bezier(a, c, b, step):
    length = math.dist(a, c) + math.dist(c, b)
    n = max(2, int(length / step))
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
                    (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]))
    return pts


def _normals(pts):
    out = []
    for k in range(len(pts)):
        a = pts[max(0, k - 1)]
        b = pts[min(len(pts) - 1, k + 1)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        n = math.hypot(dx, dz) or 1
        out.append((-dz / n, dx / n, dx / n, dz / n))   # normal x, z, then tangent x, z
    return out


def _angle_gap(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


def generate(seed, size="town", season="autumn", name="", on_step=None):
    """The town as a plain dict the game draws. `on_step(percent, message)` reports progress."""
    size = size if size in SIZES else "town"
    season = season if season in SEASONS else "autumn"
    step = on_step or (lambda pct, msg: None)
    rng = random.Random(seed * 31 + list(SIZES).index(size))
    R = SIZES[size]
    g = Ground()

    # The square and the gates.
    step(5, "pacing out the market square")
    square = 10 + R * 0.06
    g.disc(g.roads, 0, 0, square)
    ngates = {"hamlet": 2, "village": 3, "town": 3, "city": 4}[size]
    base = rng.uniform(0, 2 * math.pi)
    gates = [(base + k * 2 * math.pi / ngates + rng.uniform(-0.25, 0.25)) % (2 * math.pi)
             for k in range(ngates)]

    # Streets: one from each gate to the square, bending as it goes, and a ring road.
    step(12, "laying the high streets")
    streets = []
    for a in gates:
        start = ((R + 30) * math.cos(a), (R + 30) * math.sin(a))
        end = (square * 0.8 * math.cos(a), square * 0.8 * math.sin(a))
        bend = rng.uniform(-0.16, 0.16) * R
        mid = (0.5 * R * math.cos(a) - bend * math.sin(a), 0.5 * R * math.sin(a) + bend * math.cos(a))
        streets.append({"pts": _bezier(start, mid, end, 2.0), "w": 5.0, "kind": "high"})
    ring_r = R * 0.6
    phase = rng.uniform(0, 6.28)
    ring = []
    n = int(2 * math.pi * ring_r / 2.5)
    for k in range(n + 1):
        t = 2 * math.pi * k / n
        r = ring_r * (1 + 0.05 * math.sin(3 * t + phase))
        ring.append((r * math.cos(t), r * math.sin(t)))
    streets.append({"pts": ring, "w": 3.8, "kind": "ring"})
    for s in streets:
        for x, z in s["pts"]:
            g.disc(g.roads, x, z, s["w"] / 2)

    # The landmarks claim their ground before any house does.
    step(20, "consecrating the church")

    def claim(dist, w, d, avoid, tries=120, turn=0.0):
        for _ in range(tries):
            a = rng.uniform(0, 2 * math.pi)
            if any(_angle_gap(a, b) < avoid for b in gates):
                continue
            x, z = dist * math.cos(a), dist * math.sin(a)
            ry = math.atan2(-x, -z) + turn     # front (+z) faces the square, unless turned
            cells = g.rect(x, z, w + 2, d + 2, ry)
            if g.free(cells) and all(math.hypot(*c) < R - 6 for c in _corners(x, z, w, d, ry)):
                g.solid |= cells
                return {"x": x, "z": z, "ry": ry, "w": w, "d": d}
        return None

    church = (claim(square + 13, 9, 18, 0.4)
              or claim((square + ring_r) / 2, 9, 16, 0.3, turn=math.pi / 2)
              or claim((ring_r + R) / 2, 9, 16, 0.25, turn=math.pi / 2))
    step(26, "raising the keep")
    keep = claim(R - 15, 14, 14, 0.6) or claim(R * 0.75, 12, 12, 0.3)
    step(30, "building the tavern")
    tavern = claim(square + 8, 10, 12, 0.3) or claim(ring_r - 9, 10, 12, 0.2)

    # Lanes: short streets from the ring towards the wall and in towards the square.
    lanes = []
    for _ in range({"hamlet": 3, "village": 5, "town": 7, "city": 10}[size]):
        a = rng.uniform(0, 2 * math.pi)
        if any(_angle_gap(a, b) < 0.3 for b in gates):
            continue
        inner = rng.random() < 0.45
        r0, r1 = (square + 1, ring_r) if inner else (ring_r, R - 7)
        pts = [((r0 + (r1 - r0) * k / 10) * math.cos(a + 0.05 * math.sin(k)),
                (r0 + (r1 - r0) * k / 10) * math.sin(a + 0.05 * math.sin(k))) for k in range(11)]
        cells = set()
        for x, z in pts:
            g.disc(cells, x, z, 1.5)
        if cells & g.solid:
            continue
        g.roads |= cells
        lanes.append({"pts": pts, "w": 3.0, "kind": "lane"})
    streets += lanes

    # Houses, shoulder to shoulder along every street.
    houses = []
    order = sorted(range(len(streets)), key=lambda k: {"high": 0, "ring": 1, "lane": 2}[streets[k]["kind"]])
    for si in order:
        s = streets[si]
        pts, norms = s["pts"], _normals(s["pts"])
        for side in (1, -1):
            k, carry = 0, 0.0
            while k < len(pts) - 1:
                x0, z0 = pts[k]
                nx, nz, tx, tz = norms[k]
                nx, nz = nx * side, nz * side
                w = rng.uniform(5.0, 7.5)
                d = rng.uniform(6.5, 9.5)
                off = s["w"] / 2 + 0.6 + d / 2
                cx, cz = x0 + nx * off, z0 + nz * off
                ry = math.atan2(-nx, -nz)
                inside = all(math.hypot(*c) < R - 4.5 for c in _corners(cx, cz, w, d, ry))
                near_centre = math.hypot(cx, cz) > square + 2
                cells = g.rect(cx, cz, w, d, ry, shrink=0.35)
                if inside and near_centre and g.free(cells):
                    g.solid |= g.rect(cx, cz, w, d, ry)
                    dist = math.hypot(cx, cz) / R
                    houses.append({
                        "x": round(cx, 2), "z": round(cz, 2), "ry": round(ry, 4),
                        "w": round(w, 2), "d": round(d, 2),
                        "floors": 1 + (rng.random() < 0.8 - dist * 0.5) + (rng.random() < 0.35 - dist * 0.3),
                        "roof": "thatch" if rng.random() < 0.15 + dist * 0.5 else "tile",
                        "ridge": "x" if rng.random() < 0.6 else "z",
                        "tint": rng.randrange(6),
                        "jetty": rng.random() < 0.6,
                        "chimney": rng.random() < 0.7,
                        "facade": rng.randrange(3),
                    })
                    # advance by the house's width
                    adv = 0.0
                    while k < len(pts) - 1 and adv < w + 0.2:
                        adv += math.dist(pts[k], pts[k + 1])
                        k += 1
                else:
                    k += 1
                carry += 1
        step(32 + int(40 * (order.index(si) + 1) / len(order)),
             f"raising houses along street {order.index(si) + 1} of {len(streets)} ({len(houses)} so far)")

    # The market: a well in the middle, stalls around it.
    stalls = []
    nst = {"hamlet": 3, "village": 4, "town": 6, "city": 8}[size]
    for k in range(nst):
        a = 2 * math.pi * k / nst + rng.uniform(-0.15, 0.15)
        if any(_angle_gap(a, b) < 0.3 for b in gates):
            a += 0.4
        r = square - 3.5
        stalls.append({"x": round(r * math.cos(a), 2), "z": round(r * math.sin(a), 2),
                       "ry": round(math.atan2(-math.cos(a), -math.sin(a)), 4), "cloth": rng.randrange(4)})

    # Lanterns at the street edges, spread as far apart as they will go.
    step(78, "hanging the lanterns")
    cands = []
    for s in streets:
        if s["kind"] == "high" and False:
            continue
        for (x, z), (nx, nz, _, _) in zip(s["pts"], _normals(s["pts"])):
            for side in (1, -1):
                px, pz = x + nx * side * (s["w"] / 2 - 0.3), z + nz * side * (s["w"] / 2 - 0.3)
                if math.hypot(px, pz) < R - 4 and g.key(px, pz) not in g.solid:
                    cands.append((px, pz))
    lanterns = [min(cands, key=lambda p: abs(math.hypot(*p) - square - 1))]
    while len(lanterns) < LANTERNS[size] and cands:
        best = max(cands, key=lambda p: min(math.dist(p, q) for q in lanterns))
        lanterns.append(best)

    # The townsfolk. The lamplighter is somewhere the others will hint at.
    step(84, "waking the townsfolk")
    names = rng.sample(FIRST, 6)
    hide = rng.choice([h for h in ("church", "keep", "gate") if (h != "church" or church) and (h != "keep" or keep)])
    if hide == "church":
        lx, lz = _front(church, -church["d"] / 2 - 7.5)   # behind the tower
    elif hide == "keep":
        lx, lz = _front(keep, keep["d"] / 2 + 2.5)
    else:
        a = gates[-1]
        lx, lz = (R + 22) * math.cos(a) + 5 * math.sin(a), (R + 22) * math.sin(a) - 5 * math.cos(a)
    ga = gates[0]
    folk = [
        {"role": "innkeeper", "name": names[0], **_pt(_front(tavern, -2) if tavern else (2, 2))},
        {"role": "guard", "name": names[1], **_pt(((R + 4) * math.cos(ga) + 3 * math.sin(ga), (R + 4) * math.sin(ga) - 3 * math.cos(ga)))},
        {"role": "priest", "name": names[2], **_pt(_front(church, church["d"] / 2 + 3) if church else (6, 0))},
        {"role": "baker", "name": names[3], **_pt((stalls[0]["x"] * 0.75, stalls[0]["z"] * 0.75))},
        {"role": "child", "name": names[4], **_pt((-3.5, 2.5))},
        {"role": "lamplighter", "name": names[5], **_pt((lx, lz))},
    ]

    # Trees and fields beyond the walls, and a few in back gardens.
    step(90, "planting the orchards")
    trees = []
    for _ in range(int(R * 2.2)):
        a = rng.uniform(0, 2 * math.pi)
        r = rng.uniform(R + 8, R + 70)
        if any(_angle_gap(a, b) < 9 / r for b in gates):
            continue
        trees.append({"x": round(r * math.cos(a), 1), "z": round(r * math.sin(a), 1),
                      "kind": "pine" if rng.random() < 0.3 else "oak", "s": round(rng.uniform(0.8, 1.35), 2)})
    for _ in range(int(R * 0.6)):
        x, z = rng.uniform(-R, R), rng.uniform(-R, R)
        if math.hypot(x, z) < R - 5 and g.free(g.rect(x, z, 4, 4, 0)):
            g.solid |= g.rect(x, z, 3, 3, 0)
            trees.append({"x": round(x, 1), "z": round(z, 1), "kind": "oak", "s": round(rng.uniform(0.6, 0.9), 2)})
    fields = []
    for k in range(ngates):
        a0, a1 = gates[k], gates[(k + 1) % ngates]
        span = (a1 - a0) % (2 * math.pi)
        for f in range(2 + (span > 2)):
            a = a0 + span * (f + 1) / (3 + (span > 2))
            r = R + rng.uniform(16, 30)
            fields.append({"x": round(r * math.cos(a), 1), "z": round(r * math.sin(a), 1),
                           "ry": round(math.atan2(-math.cos(a), -math.sin(a)), 3),
                           "w": round(rng.uniform(16, 26), 1), "d": round(rng.uniform(12, 18), 1),
                           "crop": rng.randrange(3)})

    step(97, "writing the charter")
    return {
        "name": name, "seed": seed, "size": size, "season": season, "radius": R,
        "square": round(square, 2), "gates": [round(a, 4) for a in gates],
        "streets": [{"w": s["w"], "kind": s["kind"], "pts": [(round(x, 2), round(z, 2)) for x, z in s["pts"]]}
                    for s in streets],
        "houses": houses, "church": church, "keep": keep, "tavern": tavern,
        "stalls": stalls, "lanterns": [(round(x, 2), round(z, 2)) for x, z in lanterns],
        "folk": folk, "hideout": hide, "trees": trees, "fields": fields,
    }


def _corners(x, z, w, d, ry):
    cs, sn = math.cos(ry), math.sin(ry)
    return [(x + u * cs + v * sn, z - u * sn + v * cs) for u in (-w / 2, w / 2) for v in (-d / 2, d / 2)]


def _front(b, v):
    """A point `v` metres along a building's facing axis from its centre."""
    return b["x"] + v * math.sin(b["ry"]), b["z"] + v * math.cos(b["ry"])


def _pt(p):
    return {"x": round(p[0], 2), "z": round(p[1], 2)}
