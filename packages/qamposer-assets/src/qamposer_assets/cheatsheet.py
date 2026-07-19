"""Booth-staff cheat-sheet — a single A4 quick-reference page (SVG → PDF).

One page a booth attendant can pin next to the screen: the start commands, the
on-host URLs, the iPhone cert tap-through, a troubleshooting table, the CNOT +
rotation-dial rules, and two QR codes (a live ``entangible.org`` code plus a
placeholder pointing at the ``/debug`` QR, since the host's LAN IP is not known
at print time).

Same design language as the board mat: IBM Carbon greys + IBM Plex (from
``assets.toml``), millimetre user units, rendered through the shared
``svg -> pdf`` pipeline. QR codes are drawn as vector module rects (via the
``qrcode`` matrix) so they need no raster embedding.
"""

from __future__ import annotations

import qrcode

from .config import AssetsConfig
from .paper import page_size
from .svgbase import fmt, line, rect, svg_document
from .symbols import control_dot, target_cross, text

__all__ = ["ENTANGIBLE_URL", "cheatsheet_svg", "cheatsheet_svgs"]

#: The public "what is this?" URL encoded in the live QR code.
ENTANGIBLE_URL = "https://entangible.org"

# Light UI fills (not physical geometry, so not sourced from assets.toml).
_CARD_FILL = "#f2f4f8"
_RULE_FILL = "#e0e4ea"
_MARGIN = 13.0


# ---------------------------------------------------------------------------
# QR code as vector module rects
# ---------------------------------------------------------------------------


def _qr_group(data: str, x: float, y: float, size: float, *, dark: str) -> str:
    """A QR code for ``data`` as an ``size``×``size`` mm group at (x, y)."""
    qr = qrcode.QRCode(border=1, box_size=1)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    module = size / n
    parts = [rect(x, y, size, size, fill="#ffffff")]
    for r, row in enumerate(matrix):
        for c, on in enumerate(row):
            if on:
                parts.append(
                    rect(
                        x + c * module,
                        y + r * module,
                        module,
                        module,
                        fill=dark,
                    )
                )
    return "".join(parts)


# ---------------------------------------------------------------------------
# Text block helpers (all return svg strings; caller tracks the y cursor)
# ---------------------------------------------------------------------------


def _heading(x: float, y: float, s: str, fam: str, color: str) -> str:
    return text(
        x, y, s, size=4.6, color=color, family=fam, weight="bold",
        anchor="start", baseline="alphabetic", letter_spacing=0.5,
    )


def _body(x: float, y: float, s: str, fam: str, color: str, *, weight: str = "normal") -> str:
    return text(
        x, y, s, size=3.5, color=color, family=fam, weight=weight,
        anchor="start", baseline="alphabetic",
    )


def _mono(x: float, y: float, s: str, fam: str, color: str) -> str:
    # No mono in the config font stack; render commands as bold body text.
    return text(
        x, y, s, size=3.5, color=color, family=fam, weight="bold",
        anchor="start", baseline="alphabetic",
    )


# ---------------------------------------------------------------------------
# The page
# ---------------------------------------------------------------------------


def cheatsheet_svg(cfg: AssetsConfig) -> str:
    """The booth-staff cheat-sheet as a single-page A4 SVG document."""
    pw, ph = page_size("A4")
    fam = cfg.typography.font_family
    n = cfg.colors.neutral
    ink, label, faint = n.ink, n.label, n.faint
    cnot_color = cfg.colors.CNOT

    parts: list[str] = [rect(0, 0, pw, ph, fill="#ffffff")]

    # --- header -----------------------------------------------------------
    parts.append(
        text(_MARGIN, 22.0, "Entangible", size=13.0, color=ink, family=fam,
             weight="bold", anchor="start", baseline="alphabetic")
    )
    parts.append(
        text(_MARGIN, 29.0, "Booth staff · quick reference", size=4.4,
             color=label, family=fam, weight="normal", anchor="start",
             baseline="alphabetic")
    )
    parts.append(line(_MARGIN, 33.0, pw - _MARGIN, 33.0, stroke=_RULE_FILL, stroke_width=0.5))

    # Two columns.
    lx = _MARGIN
    rx = 118.0
    top = 44.0

    # --- LEFT COLUMN ------------------------------------------------------
    y = top
    parts.append(_heading(lx, y, "START", fam, ink)); y += 7.0
    parts.append(rect(lx, y - 4.6, 96.0, 7.0, fill=_CARD_FILL, rx=1.5))
    parts.append(_mono(lx + 2.0, y, "make demo", fam, ink)); y += 5.5
    parts.append(_body(lx + 2.0, y, "build the app + serve the replay loop", fam, faint)); y += 7.0
    parts.append(rect(lx, y - 4.6, 96.0, 7.0, fill=_CARD_FILL, rx=1.5))
    parts.append(_mono(lx + 2.0, y, "qamposer-physical run --open", fam, ink)); y += 5.5
    parts.append(_body(lx + 2.0, y, "kiosk host (HTTPS :8443) + open the booth screen", fam, faint)); y += 9.0

    parts.append(_heading(lx, y, "URLs  (on the host, :8443)", fam, ink)); y += 6.5
    for tag, url in (
        ("big screen", "/?kiosk"),
        ("staff", "/debug"),
        ("phone camera", "/debug (QR)"),
        ("learn more", "entangible.org"),
    ):
        parts.append(_body(lx, y, tag, fam, label))
        parts.append(_mono(lx + 34.0, y, url, fam, ink))
        y += 5.2
    y += 4.0

    parts.append(_heading(lx, y, "iPhone camera — accept the cert (Safari)", fam, ink)); y += 6.5
    for i, step in enumerate((
        "Scan the phone-camera QR on /debug.",
        "Tap Show Details → visit this website.",
        "Tap Proceed, then Start camera → Allow.",
    ), start=1):
        parts.append(_body(lx, y, f"{i}.  {step}", fam, label)); y += 5.2
    y += 4.0

    parts.append(_heading(lx, y, "RULES", fam, ink)); y += 6.5
    # CNOT rule with the ● — ⊕ glyph cluster.
    gy = y - 1.2
    parts.append(control_dot(lx + 1.4, gy, 1.4, fill=cnot_color))
    parts.append(line(lx + 2.8, gy, lx + 6.4, gy, stroke=cnot_color, stroke_width=0.5))
    parts.append(target_cross(lx + 7.8, gy, 1.4, color=cnot_color))
    parts.append(_body(lx + 11.0, y, "in the same column link into a CNOT.", fam, label)); y += 5.4
    parts.append(_body(lx, y, "Rotation dial: turn the tile to set the angle", fam, label)); y += 4.6
    parts.append(_body(lx, y, "(0°/90°/180°/270° → π/4, π/2, π, −π/2).", fam, faint)); y += 6.0

    # --- RIGHT COLUMN: troubleshooting -----------------------------------
    ry = top
    parts.append(_heading(rx, ry, "TROUBLESHOOTING", fam, ink)); ry += 7.5
    rows = [
        ("No board detected", "Check all 4 corner markers are visible; add even light."),
        ("No circuit on screen", "Open /debug: confirm fps > 0 and stable markers."),
        ("Phone won’t connect", "Same Wi-Fi; open the https:// link and accept the cert."),
    ]
    col_w = pw - _MARGIN - rx
    for sym, fix in rows:
        parts.append(rect(rx, ry - 4.8, col_w, 15.5, fill=_CARD_FILL, rx=1.5))
        parts.append(_body(rx + 2.0, ry, sym, fam, ink, weight="bold")); ry += 5.0
        # naive two-line wrap on the fix text
        words = fix.split(" ")
        line1, line2, cur = [], [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if len(trial) > 40 and line1 == []:
                line1 = [cur]; cur = w
            elif len(trial) > 40:
                line2.append(cur); cur = w
            else:
                cur = trial
        if not line1:
            line1 = [cur]; cur = ""
        parts.append(_body(rx + 2.0, ry, " ".join(line1), fam, label)); ry += 4.4
        parts.append(_body(rx + 2.0, ry, (" ".join(line2) + " " + cur).strip(), fam, label))
        ry += 8.5

    # --- QR codes (bottom band) ------------------------------------------
    qr_size = 34.0
    qy = ph - _MARGIN - qr_size - 13.0
    parts.append(line(_MARGIN, qy - 8.0, pw - _MARGIN, qy - 8.0, stroke=_RULE_FILL, stroke_width=0.5))

    # Live entangible.org QR.
    parts.append(_qr_group(ENTANGIBLE_URL, lx, qy, qr_size, dark=ink))
    parts.append(_body(lx, qy + qr_size + 5.0, "entangible.org", fam, ink, weight="bold"))
    parts.append(_body(lx, qy + qr_size + 9.5, "what is this? project links & guide", fam, faint))

    # Placeholder for the /debug (phone-camera) QR — no live IP at print time.
    px = lx + 62.0
    parts.append(
        rect(px, qy, qr_size, qr_size, fill="#ffffff", stroke=faint,
             stroke_width=0.5, rx=2.0, dash="2,2")
    )
    parts.append(
        text(px + qr_size / 2.0, qy + qr_size / 2.0, "QR on /debug", size=3.4,
             color=faint, family=fam, weight="normal", anchor="middle",
             baseline="central")
    )
    parts.append(_body(px, qy + qr_size + 5.0, "phone camera", fam, ink, weight="bold"))
    parts.append(_body(px, qy + qr_size + 9.5, "scan the QR shown on /debug (host IP)", fam, faint))

    parts.append(
        text(pw - _MARGIN, ph - _MARGIN, "entangible.org · qamposer.org · rasqberry.org",
             size=3.2, color=faint, family=fam, weight="normal", anchor="end",
             baseline="alphabetic")
    )

    return svg_document(pw, ph, "".join(parts), title="Entangible booth cheat-sheet")


def cheatsheet_svgs(cfg: AssetsConfig) -> list[str]:
    """The cheat-sheet as a one-page list (matches the emit() page API)."""
    return [cheatsheet_svg(cfg)]
