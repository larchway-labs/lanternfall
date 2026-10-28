"""Lanternfall — light a medieval town's lanterns before midnight.

The page is the game. Each town is laid out by town.py from its name, size and
season; founding one starts the `found` job, and the towns somebody founded
are read back from that job's run history, so nothing has to be stored but
the best times.
"""

import datetime
import functools
import logging
import os
import threading
import time

from flask import Flask, abort, jsonify, render_template, request, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

import town as towns

try:
    import toft
except ImportError:  # running locally, before the platform installed the SDK
    toft = None

app = Flask(__name__)
# Toft mounts the app under /apps/<slug>; x_prefix makes url_for() say so.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("lanternfall")


@app.before_request
def _clock():
    request._t0 = time.perf_counter()


@app.after_request
def _access_log(resp):
    quiet = request.path in ("/healthz", "/api/event") or request.path.startswith("/static/")
    if not quiet:
        ms = (time.perf_counter() - request._t0) * 1000
        log.info("%-4s %-40s %d  %5.0f ms", request.method, request.full_path.rstrip("?"), resp.status_code, ms)
    return resp


@functools.lru_cache(maxsize=32)
def _layout(seed, size, season, name):
    return towns.generate(seed, size, season, name)


def _founded():
    """Towns the `found` job has laid out, newest first, from its run history."""
    if toft is None:
        return []
    try:
        runs = toft.jobs.list(job="found", status="succeeded", limit=30)
    except Exception as exc:  # off-platform, or the platform said no
        log.warning("could not read the run history: %s", exc)
        return []
    out = []
    for run in runs:
        p = run.params
        name = str(p.get("name") or "Nowhere")
        out.append({"name": name, "seed": int(p.get("seed") or towns.seed_for(name)),
                    "size": p.get("size") or "town", "season": p.get("season") or "autumn", "run": run.id[:8]})
    return out


# The best times, per town, in the app's one JSON document. Off-platform they
# live in memory.
_scores_local = {}
_scores_lock = threading.Lock()


def _scores(seed):
    if toft is not None and os.environ.get("TOFT_APP_ID"):
        try:
            doc = toft.data.get() or {}
            return doc.get("scores", {}).get(str(seed), [])
        except Exception as exc:
            log.warning("could not read the best times: %s", exc)
            return []
    return _scores_local.get(str(seed), [])


def _record(seed, entry):
    def add(doc):
        board = doc.setdefault("scores", {}).setdefault(str(seed), [])
        board.append(entry)
        board.sort(key=lambda e: e["seconds"])
        del board[5:]
        if len(doc["scores"]) > 60:  # forget the least recently set towns
            for old in list(doc["scores"])[:-60]:
                del doc["scores"][old]

    if toft is not None and os.environ.get("TOFT_APP_ID"):
        try:
            toft.data.update(add)
        except Exception as exc:
            log.warning("could not record a time: %s", exc)
        return
    with _scores_lock:
        add({"scores": _scores_local})


def _page(meta):
    return render_template(
        "index.html",
        town=meta,
        realm=os.environ.get("REALM", "In the Marches of the North"),
        towns=_founded(),
        scores=_scores(meta["seed"]),
        sizes=list(towns.SIZES),
        seasons=list(towns.SEASONS),
        on_toft=toft is not None and bool(os.environ.get("TOFT_APP_ID")),
    )


def _meta_from_args(seed):
    size = request.args.get("size", "town")
    season = request.args.get("season", "autumn")
    if size not in towns.SIZES or season not in towns.SEASONS:
        abort(404)
    return {"name": request.args.get("name", "Nowhere")[:32], "seed": seed % 100000, "size": size, "season": season}


@app.get("/")
def index():
    return _page(towns.town_of_the_day(datetime.date.today()))


@app.get("/town/<int:seed>")
def town_page(seed):
    return _page(_meta_from_args(seed))


@app.get("/town/<int:seed>.json")
def layout(seed):
    m = _meta_from_args(seed)
    resp = jsonify(_layout(m["seed"], m["size"], m["season"], m["name"]))
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@app.post("/api/event")
def event():
    e = request.get_json(silent=True) or {}
    kind = str(e.get("kind", ""))[:16]
    where = f"{str(e.get('name', '?'))[:32]} ({e.get('size')}, {e.get('season')})"
    at = f"{e.get('clock', '--:--')}"
    if kind == "start":
        log.info("⚑ a traveller enters %s at %s, %s", where, at, "to light the lanterns" if e.get("mode") == "play" else "to wander")
    elif kind == "talk":
        log.info("  … talks to the %s in %s", str(e.get("who", "?"))[:16], where)
    elif kind == "lit":
        log.info("  ✦ lantern %s of %s lit in %s at %s", e.get("n"), e.get("total"), where, at)
    elif kind == "finish":
        secs = int(e.get("seconds") or 0)
        log.info("★ every lantern in %s burning by %s (%dm %02ds)%s", where, at, secs // 60, secs % 60,
                 ", and the lamplighter found" if e.get("lamplighter") else "")
        _record(int(e.get("seed") or 0), {"seconds": secs, "clock": at, "at": datetime.date.today().isoformat()})
    elif kind == "midnight":
        log.info("☾ midnight in %s with %s of %s lanterns lit", where, e.get("n"), e.get("total"))
    return {"ok": True}


@app.post("/found")
def found():
    name = (request.form.get("name") or "").strip()[:32]
    if not name:
        abort(400)
    params = {"name": name, "size": request.form.get("size", "town"), "season": request.form.get("season", "autumn")}
    try:
        run = toft.viewer(request.headers).jobs.start("found", params=params)
    except Exception:  # an anonymous visitor to a public app: found it as the app
        run = toft.jobs.start("found", params=params)
    log.info("founding %r (%s, %s) as run %s", name, params["size"], params["season"], run.id[:8])
    return toft.jobs.respond(run, request=request)


@app.get("/healthz")
def healthz():
    return {"ok": True}
