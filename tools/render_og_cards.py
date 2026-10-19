"""Link-preview cards for the two games: og-golf.png and og-runner.png.

Screenshots of the REAL app — the production build in pocket-app/dist, served
locally and driven in headless Chrome over the DevTools protocol — so a card
can never show a game that does not exist. Nothing is drawn by hand: each card
lays one capture of the running game (taken at 2× for crisp text) beside its
title, in the app's own fonts, at the Open Graph size of 1200×630. The runner
is a live game: Math.random is seeded so it deals the same lanes, but frame
timing still varies, so two renders are alike rather than byte-identical.

Outputs (checked in, served at the site root):
    pocket-app/public/og-golf.png    - Quantum Golf, hole E2 (Bell) of the classic 18
    pocket-app/public/og-runner.png  - Quantum Runner, a two-qubit run

Regenerate (needs Google Chrome or a Playwright Chromium; override with
CHROME=/path/to/chrome):
    (cd pocket-app && npm run build)
    uv run python tools/render_og_cards.py
"""

from __future__ import annotations

import argparse
import base64
import functools
import http.server
import io
import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from PIL import Image
from websockets.sync.client import connect

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "pocket-app" / "dist"
PUBLIC = ROOT / "pocket-app" / "public"

WIDTH, HEIGHT = 1200, 630  # the Open Graph large-card size
SCALE = 2  # capture at 2× and downsample: sharp text at 1200×630
MAX_BYTES = 300_000  # keep each card light for crawlers


def find_chrome() -> str:
    env = os.environ.get("CHROME")
    if env:
        return env
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        *sorted(
            Path.home().glob(
                "Library/Caches/ms-playwright/chromium-*/chrome-mac*/"
                "Chromium.app/Contents/MacOS/Chromium"
            ),
            reverse=True,
        ),
        *sorted(Path.home().glob(".cache/ms-playwright/chromium-*/chrome-linux*/chrome"), reverse=True),
    ]
    for c in candidates:
        if Path(c).exists():
            return str(c)
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    raise SystemExit("No Chrome found; set CHROME=/path/to/chrome")


def serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, int]:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args: object) -> None:  # noqa: D102
            pass

    handler = functools.partial(Quiet, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


class Page:
    """A minimal synchronous CDP client for one page target."""

    def __init__(self, ws_url: str) -> None:
        self.ws = connect(ws_url, max_size=64 * 1024 * 1024)
        self.next_id = 0

    def send(self, method: str, **params: object) -> dict:
        self.next_id += 1
        my_id = self.next_id
        self.ws.send(json.dumps({"id": my_id, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == my_id:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expr: str) -> object:
        res = self.send("Runtime.evaluate", expression=expr, awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in res:
            raise RuntimeError(f"JS error in {expr!r}: {res['exceptionDetails']}")
        return res.get("result", {}).get("value")

    def wait_for(self, expr: str, timeout: float = 15.0) -> None:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.eval(f"Boolean({expr})"):
                return
            time.sleep(0.1)
        raise TimeoutError(f"timed out waiting for {expr}")

    def goto(self, url: str) -> None:
        self.send("Page.navigate", url=url)
        self.wait_for("document.readyState === 'complete'")

    def shot(self) -> Image.Image:
        data = self.send("Page.captureScreenshot", format="png")["data"]
        img = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")
        return img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)


def launch(chrome: str, profile: str) -> tuple[subprocess.Popen, Page]:
    proc = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            "--remote-debugging-port=0",
            f"--user-data-dir={profile}",
            "--no-first-run",
            "--no-default-browser-check",
            "--hide-scrollbars",
            "--lang=en-US",
            "--mute-audio",
            f"--window-size={WIDTH},{HEIGHT}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    port_file = Path(profile) / "DevToolsActivePort"
    for _ in range(200):
        if port_file.exists() and port_file.read_text().strip():
            break
        time.sleep(0.05)
    port = int(port_file.read_text().split()[0])
    targets = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list"))
    ws = next(t["webSocketDebuggerUrl"] for t in targets if t["type"] == "page")
    page = Page(ws)
    page.send("Page.enable")
    page.send("Runtime.enable")
    page.send("Network.enable")
    # No analytics hits from a render run.
    page.send("Network.setBlockedURLs", urls=["*umami*"])
    viewport(page, WIDTH, HEIGHT)
    return proc, page


def save(img: Image.Image, name: str) -> Path:
    out = PUBLIC / name
    img.save(out, format="PNG", optimize=True)
    if out.stat().st_size > MAX_BYTES:
        # A UI screenshot has few real colours: an adaptive palette keeps it
        # visually identical at a fraction of the size.
        img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(
            out, format="PNG", optimize=True
        )
    size = out.stat().st_size
    if size > MAX_BYTES:
        raise SystemExit(f"{out} is {size} bytes (> {MAX_BYTES})")
    print(f"wrote {out.relative_to(ROOT)} ({size} bytes)")
    return out


# Math.random, seeded (mulberry32): the runner deals its coins and obstacles
# from it, so a fixed seed makes the captured run the same on every render.
SEED_RANDOM = """
(() => {
  let a = 0x9e3779b9;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
"""


def rect_of(page: Page, expr: str) -> dict:
    """The page-space rectangle of the element `expr` evaluates to."""
    r = page.eval(
        f"""(() => {{
          const r = ({expr}).getBoundingClientRect();
          return {{ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }};
        }})()"""
    )
    assert isinstance(r, dict)
    return r


def viewport(page: Page, width: int, height: int) -> None:
    page.send(
        "Emulation.setDeviceMetricsOverride",
        width=width,
        height=height,
        deviceScaleFactor=SCALE,
        mobile=False,
    )


def capture(page: Page, rect: dict, pad: float = 8) -> str:
    """A PNG (base64) of one page region (plus a margin), at the device scale factor."""
    clip = {
        "x": max(0.0, rect["x"] - pad),
        "y": max(0.0, rect["y"] - pad),
        "width": rect["width"] + 2 * pad,
        "height": rect["height"] + 2 * pad,
        "scale": 1,
    }
    return page.send("Page.captureScreenshot", format="png", clip=clip)["data"]


def click(page: Page, selector: str, text: str | None = None) -> None:
    """Click the first element matching `selector` (and starting with `text`)."""
    match = "true" if text is None else f"e.textContent.trim().startsWith({json.dumps(text)})"
    find = f"[...document.querySelectorAll({json.dumps(selector)})].find((e) => {match})"
    page.wait_for(find)
    page.eval(f"{find}.click()")


CARD_CSS = """
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0f1117; }
.og { position: fixed; inset: 0; display: flex; align-items: center; gap: 44px;
      padding: 0 48px 0 60px; box-sizing: border-box; color: #e6e9ef;
      font-family: 'IBM Plex Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: radial-gradient(900px 500px at 85% 50%, rgba(122, 92, 255, 0.16), transparent 70%),
        #0f1117; }
.og-text { flex: 0 0 410px; display: flex; flex-direction: column; gap: 18px; }
.og-brand { font-size: 26px; font-weight: 700; letter-spacing: 0.01em; }
.og-brand span { color: #7a5cff; }
.og-title { font-size: 64px; line-height: 1.02; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.og-lead { font-size: 25px; line-height: 1.35; margin: 0; }
.og-meta { font-size: 19px; line-height: 1.4; margin: 0; color: #8a91a0; }
.og-url { font-size: 21px; font-weight: 600; color: #a996ff; margin-top: 6px; }
.og-shot { flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
           height: 100%; min-width: 0; }
.og-shot img { display: block; max-width: 100%; max-height: 560px; border-radius: 14px;
               border: 1px solid #2a2f3a; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); }
"""


def card(page: Page, shot_b64: str, title: str, lead: str, meta: str, url: str) -> Image.Image:
    """Lay one game capture beside its title, in the app's own fonts, and shoot it."""
    sheets = page.eval("[...document.querySelectorAll('link[rel=stylesheet]')].map((l) => l.href)")
    assert isinstance(sheets, list)
    links = "".join(f'<link rel="stylesheet" href="{h}">' for h in sheets)
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">{links}
<style>{CARD_CSS}</style></head><body><div class="og">
  <div class="og-text">
    <div class="og-brand"><span>En</span>tangible</div>
    <h1 class="og-title">{title}</h1>
    <p class="og-lead">{lead}</p>
    <p class="og-meta">{meta}</p>
    <div class="og-url">{url}</div>
  </div>
  <div class="og-shot"><img alt="" src="data:image/png;base64,{shot_b64}"></div>
</div></body></html>"""
    viewport(page, WIDTH, HEIGHT)
    # Same origin as the app, so the app's own stylesheets (and their IBM Plex
    # @font-face files) load for the card text.
    page.eval(f"document.open(); document.write({json.dumps(html)}); document.close(); 1")
    page.wait_for("[...document.querySelectorAll('link[rel=stylesheet]')].every((l) => l.sheet)")
    page.eval(
        "Promise.all(['700 64px', '400 25px', '600 21px']"
        ".map((f) => document.fonts.load(f + ' \"IBM Plex Sans\"')))"
        ".then(() => document.fonts.ready).then(() => 1)"
    )
    page.wait_for("document.querySelector('.og-shot img').complete")
    time.sleep(0.3)
    return page.shot()


def render_golf(page: Page, base: str) -> None:
    """Hole E2 (Bell) of the classic 18, opened the way the share link opens golf."""
    viewport(page, 1440, 900)  # a desktop window: the sphere gets room
    page.goto(base + "?mode=golf&input=manual&lang=en")
    click(page, "button", "E2")
    page.wait_for("document.querySelector('.pk-golf-goal')?.textContent.includes('always agree')")
    time.sleep(1.5)  # let the sphere settle
    shot = capture(page, rect_of(page, "document.querySelector('.pk-well')"))
    img = card(
        page,
        shot,
        "Quantum Golf",
        "Each hole hands you a target quantum state. Build a circuit that makes it.",
        "Every gate counts a stroke. Eighteen holes in four rounds, built on screen in your browser.",
        "entangible.org/golf",
    )
    save(img, "og-golf.png")


def render_runner(page: Page, base: str) -> None:
    """A two-qubit run in a Bell state (H₀, then CX 0→1): two lanes at 50 %."""
    page.goto(base + "?mode=runner&lang=en")
    click(page, ".pk-runner-lvl", "2 qubits")
    page.wait_for("document.querySelectorAll('.pk-runner-ghost').length === 4")
    if page.eval("Boolean(document.querySelector('.pk-runner-hold'))"):
        click(page, ".pk-runner-restart")
    page.wait_for("!document.querySelector('.pk-runner-gate').disabled")
    click(page, '[aria-label="Apply H to qubit 0"]')
    click(page, '[aria-label="Apply CX, control qubit 0, target qubit 1"]')
    # Wait for coins and an obstacle ahead of the runner, all
    # three lives left and the Bell state intact.
    page.wait_for(
        """(() => {
          const ahead = (k) => [...document.querySelectorAll('.pk-runner-cell--' + k)]
            .filter((c) => { const l = parseFloat(c.style.left); return l > 30 && l < 85; }).length;
          const p = [...document.querySelectorAll('.pk-runner-ghost')].map((g) => g.dataset.prob);
          return ahead('coin') >= 2 && ahead('obstacle') >= 1 &&
            document.querySelectorAll('.pk-runner-heart').length === 3 &&
            p.join() === '0.500,0.000,0.000,0.500';
        })()""",
        timeout=60,
    )
    shot = capture(page, rect_of(page, "document.querySelector('.pk-runner')"))
    img = card(
        page,
        shot,
        "Quantum Runner",
        "You run in every lane at once. Tap X, H and CX to change your state while you run.",
        "Coins pay out by probability; obstacles measure you. One or two qubits, in your browser.",
        "entangible.org/runner",
    )
    save(img, "og-runner.png")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dist", type=Path, default=DIST, help="the built site (npm run build)")
    args = ap.parse_args()
    if not (args.dist / "index.html").exists():
        raise SystemExit(f"{args.dist} has no index.html; run `npm run build` in pocket-app")

    server, port = serve(args.dist)
    base = f"http://127.0.0.1:{port}/"
    with tempfile.TemporaryDirectory() as profile:
        proc, page = launch(find_chrome(), profile)
        try:
            page.send("Page.addScriptToEvaluateOnNewDocument", source=SEED_RANDOM)
            render_golf(page, base)
            render_runner(page, base)
        finally:
            proc.terminate()
            proc.wait(timeout=10)
            server.shutdown()


if __name__ == "__main__":
    main()


