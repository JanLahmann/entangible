# Entangible WebSocket protocol — v1

> Single source of truth for the wire protocol between `qamposer-physical-host`
> and its browser clients, and for the in-process contract between the vision
> pipeline and the host. `display-app/src/ws/messages.ts` mirrors the schemas
> here 1:1; a vitest parity test guards the field names. All JSON field names
> are camelCase.

## Endpoints (single HTTPS origin, default `:8443`)

| Path         | Transport            | Purpose                                    |
|--------------|----------------------|--------------------------------------------|
| `/ws/state`  | WebSocket, JSON text | Server → clients: circuit/detection/status |
| `/ws/frames` | WebSocket, binary    | Phone camera → server JPEG frames (M4)     |

## `/ws/state` — server → client messages

Every message is a JSON object with a `type` discriminator.

### `circuit` — sent on every *stable* circuit change

```jsonc
{
  "type": "circuit",
  "seq": 42,                  // monotonically increasing per host process
  "circuit": { "qubits": 5, "gates": [ /* exact @qamposer/react Circuit */ ] },
  "qasm": "OPENQASM 2.0;\n...",
  "source": "camera"          // "camera" | "replay" | "push"
}
```

- `seq` increments only when the circuit actually changes (deep equality),
  which the stabilizer already guarantees.
- The **latest** `circuit` message is replayed verbatim to every new client
  immediately after connect (late-joiner catch-up), before any live traffic.

### `detection` — diagnostics, throttled to ≤ 5 Hz

```jsonc
{
  "type": "detection",
  "fps": 12.4,                          // pipeline throughput, smoothed
  "board": {
    "found": true,
    "corners": 4,                       // corner markers currently visible (0-4)
    "reprojectionErrorMm": 0.05         // null when board not found
  },
  "markers": [
    { "id": 10, "row": 0, "col": 0 },   // on-grid gate tile
    { "id": 22, "offGrid": true }       // detected but rejected by grid mapping
  ],
  "warnings": [
    { "code": "lone_control", "message": "...", "row": 1, "col": 3 }
  ]
}
```

- Corner markers (IDs 0–3) are **not** listed in `markers`.
- `warnings[].code` values come from the circuit builder (`lone_control`,
  `lone_target`, `cell_conflict`, …); `row`/`col` optional.
- Latest `detection` also replayed on connect (may be stale; `fps: 0` signals
  a stopped pipeline).

### `status` — sent on connect and on every change

```jsonc
{
  "type": "status",
  "camera":  { "kind": "replay", "name": "fixtures/bell-sequence", "connected": true },
  "backend": { "enabled": false, "healthy": false },
  "clients": 2                          // current /ws/state client count
}
```

## `/ws/state` — client → server messages

```jsonc
{ "type": "hello", "role": "display", "client": "booth-screen" }
// role: "display" | "debug" | "capture-ui"; client: free-form label, optional
```

```jsonc
{ "type": "select_camera", "kind": "cv2", "index": 0 }
// kind: "cv2" | "picamera2" | "push" | "replay"; index only for cv2
```

- `hello` is courtesy metadata (feeds `status.clients` labeling); the server
  must not require it.
- `select_camera` swaps the pipeline's frame source at runtime; the server
  answers with a fresh `status`.
- Unknown/malformed client messages are logged and ignored — never fatal.

## `/ws/frames` — phone capture (M4; server side lands in M2)

- Binary messages: JPEG-encoded frames, most-recent-wins (the server keeps a
  single latest-frame slot — `PushFrameSource`).
- Optional JSON text messages: `{ "type": "hello", "role": "capture" }`.
- Backpressure is the **client's** job (`bufferedAmount`); the server never
  queues more than one frame.

## Reconnect rules (client)

- Exponential backoff 0.5 s → 8 s, jittered, forever.
- On (re)connect the server replays latest `circuit` + `detection` + `status`.
- If a replayed `seq` is *lower* than the last seen, the host restarted:
  accept it and reset the local counter (never discard as stale).

## In-process contract: vision pipeline → host

`qamposer_vision.pipeline.Pipeline` runs the loop in a worker thread and emits
via callbacks (called on the worker thread; the host bridges to asyncio with
`loop.call_soon_threadsafe`):

```python
Pipeline(
    source: FrameSource,
    board_config: BoardConfig | None = None,   # default: assets.toml
    on_circuit: Callable[[CircuitEvent], None],    # stable changes only
    on_detection: Callable[[DetectionEvent], None] # every processed frame; host throttles to 5 Hz
)
.start() / .stop()                              # idempotent
.swap_source(source: FrameSource)               # runtime camera switch
.latest_annotated() -> np.ndarray | None        # BGR frame for /debug MJPEG
```

- `CircuitEvent`: `circuit: dict` (Circuit JSON), `qasm: str`, `source: str`.
  (`seq` is assigned by the host, not the pipeline.)
- `DetectionEvent`: `fps: float`, `board_found: bool`, `corners: int`,
  `reprojection_error_mm: float | None`, `markers: list[MarkerObs]`
  (`id`, `row`, `col` | `off_grid`), `warnings: list[BuildWarning]`.
  Snake_case in Python; the host serializes to the camelCase JSON above.

## Versioning

Additive changes (new optional fields, new message types) do not bump the
version; clients must ignore unknown fields and unknown `type`s. Breaking
changes bump to v2 and get a `{"type": "hello"}` server counterpart first.
