# iPhone browser capture — booth-staff runbook

This is the M4 "phone as camera" flow: an iPhone (or any modern phone) opens the
host's `/capture` page in its browser, and streams its rear camera to the booth as
JPEG frames over `/ws/frames`. The host feeds those frames into the vision
pipeline exactly like a USB or Pi camera, so the big screen shows the live circuit.

Use this when the host is a Raspberry Pi (which cannot use Continuity Camera), or
whenever a phone is the most convenient overhead camera. On a Mac, Continuity
Camera is usually simpler — see [`mac-booth.md`](mac-booth.md).

## How it works (one paragraph)

`/capture` calls `getUserMedia` (rear camera, ideal 1280×720), draws each frame to
a canvas, encodes it as JPEG at quality 0.7, and sends the bytes over a dedicated
`wss://…/ws/frames` WebSocket at a 10 fps target. The client paces itself and
enforces backpressure via `WebSocket.bufferedAmount` (it skips a frame when the
socket is backed up or a previous encode is still in flight), and holds a **screen
wake lock** so the phone doesn't sleep. On start it also sends
`select_camera {kind:'push'}` so the host swaps its pipeline onto the shared push
source. See [`protocol.md`](protocol.md) for the wire contract.

## Setup steps

1. **Start the host** with TLS (the default — phones need a secure context):
   ```bash
   uv run qamposer-physical run          # https on :8443
   ```
2. **Get the QR / URL.** Open `/debug` on the booth screen and find the
   **Phone camera** card (QR + `https://<lan-ip>:8443/capture`), or print it in the
   terminal with `uv run qamposer-physical qr`.
3. **Scan the QR** with the iPhone Camera app and open the link in **Safari**.

### Accept the self-signed certificate (iOS Safari)

The host uses a self-signed cert, so Safari warns the first time. Tap through it:

1. Safari shows **"This Connection Is Not Private"**.
2. Tap **Show Details**, then **visit this website** (older iOS: tap
   **Advanced**, then the "proceed to <ip>" link).
3. Confirm **Visit Website** in the sheet. The page reloads over HTTPS.

*(You only do this once per device until the cert changes — it changes if the Mac
moves to a different network, which regenerates the SANs.)*

### Grant camera permission and start

1. On `/capture`, tap the big **Start camera** button.
2. iOS prompts **"…would like to Access the Camera"** — tap **Allow**.
3. The live camera preview fills the screen with status chips at the top
   (connection, fps sent, frames dropped, wake lock) and a **Stop** button.

If the page shows an error card instead of the Start button, it is not a secure
context (you opened `http://…` or an IP without the cert accepted) — re-open the
`https://` link and tap through the cert as above.

## Mounting the phone

- Mount the phone **overhead, lens down, ~70–90 cm above the board**, framing all
  four corner markers with a little margin. This matches the detection geometry in
  [`design.md`](design.md) (≈11–16 px per ArUco bit at 720p).
- A **gooseneck phone holder** clamped to the table edge, or a small **tripod with
  a phone clamp** and a horizontal arm, both work well. Keep the phone steady — the
  homography re-fits when corners drift, but a wobbling phone costs fps.
- Avoid casting a shadow across the board; diffuse overhead light is best.

## Wake lock & battery

- The page requests a **screen wake lock** so the phone won't auto-lock mid-demo;
  the "screen awake" chip shows its state. iOS drops the lock when you switch apps
  or the tab is backgrounded — the page **re-acquires it automatically** when you
  return, and **pauses capturing while backgrounded** (no wasted frames/battery).
- Streaming the camera is power-hungry. **Keep the phone on a charger** for
  all-day booths; a battery bank on the mount works.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No **Start camera** button, error card instead | Not a secure context (opened over `http://` or IP without cert) | Open the `https://` link; tap through the cert (Show Details → Proceed) |
| No camera permission prompt | Same as above, or permission previously denied | Re-open over HTTPS; in iOS Settings → Safari → Camera, allow for the site |
| Connection chip stuck on **connecting** | Firewall blocking LAN, or wrong network | On a Mac host, allow the firewall (see [`mac-booth.md`](mac-booth.md)); put phone on the **same** Wi-Fi |
| Frames flow but **no circuit** on screen | Board corners not all visible / off-grid tiles | On `/debug` confirm **4 corners** and low reprojection error; re-aim the phone |
| Laggy / low **fps sent**, many **dropped** | Poor light (long exposure), phone too far, or weak Wi-Fi | Add light, move the phone closer/steadier, reduce distance to the AP |
| Detection flickers as hands move | Expected — hysteresis absorbs it | Place all tiles, then remove hands; the circuit settles in ~0.5–1 s |
| Screen keeps dimming/locking | Wake lock denied | Check the "screen awake" chip; keep the tab foregrounded; some low-power modes block wake lock |

Note: stopping the phone (or closing the tab) just **stops sending frames** — it
does **not** switch the host back to another camera. Booth staff choose the active
source (restart with `--source …`, or use a `capture-ui` client).

---

## REAL-DEVICE CHECKLIST (for Jan — needs the printed kit + an iPhone)

All testing so far is synthetic. These are the six M4 verification steps from
[`design.md`](design.md) to run once, against **both** a Mac host and a Pi host:

- [ ] **Print the M1 kit** — gate tiles + board mat (`uv run qamposer-assets all`),
      lay the mat flat, place a couple of tiles.
- [ ] **Scan the QR** from `/debug` (Phone camera card) with the iPhone and open
      `/capture` in Safari.
- [ ] **Accept the self-signed cert** (Show Details → visit this website →
      Proceed); confirm the page reloads over `https://` and shows **Start camera**.
- [ ] **Start camera + allow permission**; confirm the live preview fills the
      screen and the connection chip reads **streaming** with **fps ≥ 10**.
- [ ] **Frames flow into detection** — on `/debug`, confirm the camera shows as
      **push / connected**, **4 corners** visible, and stable markers.
- [ ] **Build a Bell pair** (H + CNOT tiles) and confirm the booth screen shows the
      Bell circuit with a **~50/50 histogram**, `source: "push"`, and that the
      phone's **wake lock** keeps the screen on for the length of the demo. Repeat
      the whole flow with the other host (Mac ↔ Pi).
