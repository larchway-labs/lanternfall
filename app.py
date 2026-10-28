"""Contour Atlas — topographic plates of islands that do not exist.

The page shows the plate of the day and every plate somebody commissioned.
Commissioning one starts the `render` job; the plates themselves are drawn on
demand from their seed, so nothing has to be stored.
"""

import datetime
import functools
import logging
import os
import time

from flask import Flask, Response, abort, render_template, request, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

import terrain

try:
    import toft
except ImportError:  # running locally, before the platform installed the SDK
    toft = None

app = Flask(__name__)
# Toft mounts the app under /apps/<slug>; x_prefix makes url_for() say so.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("atlas")


@app.before_request
def _clock():
    request._t0 = time.perf_counter()


@app.after_request
def _access_log(resp):
    if request.path != "/healthz":
        ms = (time.perf_counter() - request._t0) * 1000
        log.info("%-4s %-34s %d  %5.0f ms", request.method, request.full_path.rstrip("?"), resp.status_code, ms)
    return resp


@functools.lru_cache(maxsize=64)
def _plate(seed, name, palette, detail):
    return terrain.render(seed, name, palette, detail)


def _today():
    return terrain.plate_of_day(datetime.date.today())


def _commissioned():
    """Plates the render job has finished, newest first, from the run history."""
    if toft is None:
        return []
    try:
        runs = toft.jobs.list(job="render", status="succeeded", limit=24)
    except Exception as exc:  # off-platform, or the platform said no
        log.warning("could not read the run history: %s", exc)
        return []
    plates = []
    for run in runs:
        p = run.params
        name = str(p.get("name") or "Untitled")
        plates.append({
            "name": name,
            "seed": int(p.get("seed") or terrain.seed_for(name)),
            "palette": p.get("palette") or "ink",
            "detail": int(p.get("detail") or 12),
            "by": run.started_by,
            "when": (run.finished_at or "")[:10],
            "run": run.id[:8],
        })
    return plates


@app.get("/")
def index():
    return render_template(
        "index.html",
        title=os.environ.get("ATLAS_TITLE", "Contour Atlas"),
        today=_today(),
        plates=_commissioned(),
        palettes=list(terrain.PALETTES),
        on_toft=toft is not None and bool(os.environ.get("TOFT_APP_ID")),
    )


@app.get("/plate/<int:seed>.svg")
def plate(seed):
    name = request.args.get("name", "Untitled")[:40]
    palette = request.args.get("palette", "ink")
    detail = max(4, min(20, request.args.get("detail", 12, type=int)))
    if palette not in terrain.PALETTES:
        abort(404)
    svg = _plate(seed % 100000, name, palette, detail)
    return Response(svg, mimetype="image/svg+xml", headers={"Cache-Control": "public, max-age=86400"})


@app.post("/commission")
def commission():
    name = (request.form.get("name") or "").strip()[:40]
    palette = request.form.get("palette", "ink")
    if not name:
        return index()
    params = {"name": name, "palette": palette}
    try:
        run = toft.viewer(request.headers).jobs.start("render", params=params)
    except Exception:  # an anonymous visitor to a public atlas: commission it as the app
        run = toft.jobs.start("render", params=params)
    log.info("commissioned %r (%s) as run %s", name, palette, run.id[:8])
    return toft.jobs.respond(run, request=request)


@app.get("/healthz")
def healthz():
    return {"ok": True, "palettes": len(terrain.PALETTES)}
