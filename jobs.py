"""The game's two jobs.

    python jobs.py found            lay out a new town, on request
    python jobs.py town-of-the-day  lay out today's town, on a schedule

Both report progress as they go, which `toft job run` draws as a live line.
The pauses are deliberate: a town takes a fraction of a second to lay out,
which is too quick to watch.
"""

import datetime
import json
import sys
import time

import toft

import town as towns


def lay_out(name, size, season, seed=None):
    run = toft.run
    seed = seed if seed is not None else towns.seed_for(name)
    run.log(f"founding {name!r}: a {season} {size}, seed {seed}")
    steps = []

    def on_step(pct, message):
        steps.append(message)
        run.progress(pct, message)
        run.log(f"  {message}")
        time.sleep(0.9)

    layout = towns.generate(seed, size, season, name, on_step=on_step)
    landmarks = [k for k in ("church", "keep", "tavern") if layout[k]]
    run.log(f"done: {len(layout['houses'])} houses, {len(layout['lanterns'])} lanterns, "
            f"{len(layout['gates'])} gates, {', '.join(landmarks)}")
    try:
        run.write_output(json.dumps(layout))   # `toft job output <run>` downloads it
    except toft.ToftError as exc:
        if exc.code != "no_output":
            raise
    run.progress(100, f"{name} stands")


def found():
    p = toft.run.params
    lay_out(p["name"], p.get("size", "town"), p.get("season", "autumn"), p.get("seed"))


def town_of_the_day():
    run = toft.run
    day = (run.scheduled_for or datetime.datetime.now(datetime.timezone.utc)).date()
    t = towns.town_of_the_day(day)
    run.log(f"the town for {t['date']}")
    lay_out(t["name"], t["size"], t["season"], t["seed"])


if __name__ == "__main__":
    {"found": found, "town-of-the-day": town_of_the_day}[sys.argv[1]]()
