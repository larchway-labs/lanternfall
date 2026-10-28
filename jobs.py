"""The atlas's two jobs.

    python jobs.py render         draw one plate, on request
    python jobs.py plate-of-day   draw today's plate, on a schedule

Both print as they go and report progress, which is what `toft job run`
draws as a live line. The pauses between contours are deliberate: a plate takes
about a second to draw, which is too quick to watch.
"""

import datetime
import sys
import time

import toft

import terrain


def draw(name, palette, detail, seed=None):
    run = toft.run
    seed = seed if seed is not None else terrain.seed_for(name)
    run.log(f"surveying {name!r} — seed {seed}, palette {palette}, {detail} contours")
    run.progress(5, "surveying the terrain")
    time.sleep(1.5)

    def on_level(k, total):
        run.progress(10 + int(80 * k / total), f"tracing contour {k} of {total}")
        if k == 1:
            run.log("  coastline traced")
        elif k == total:
            run.log(f"  summit ring traced ({total - 1} contours above the sea)")
        time.sleep(0.6)

    svg = terrain.render(seed, name, palette, detail, on_level=on_level)
    run.progress(95, "lettering the cartouche")
    time.sleep(1)
    try:
        run.write_output(svg)   # `toft job output <run>` downloads it
    except toft.ToftError as exc:
        if exc.code != "no_output":
            raise
        run.log("  this install keeps no run outputs; the atlas redraws the plate from its seed")
    facts = terrain.place_facts(seed, terrain.heightmap(seed))
    run.log(f"done: summit {facts['peak_m']:,} m, {facts['land_pct']}% land, {len(svg) // 1024} KB")
    run.progress(100, "plate printed")


def render():
    p = toft.run.params
    detail = max(4, min(20, int(p.get("detail", 12))))
    draw(p["name"], p.get("palette", "ink"), detail, p.get("seed"))


def plate_of_day():
    run = toft.run
    day = (run.scheduled_for or datetime.datetime.now(datetime.timezone.utc)).date()
    plate = terrain.plate_of_day(day)
    run.log(f"the plate for {plate['date']}")
    draw(plate["name"], plate["palette"], plate["detail"], plate["seed"])


if __name__ == "__main__":
    {"render": render, "plate-of-day": plate_of_day}[sys.argv[1]]()
