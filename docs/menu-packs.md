# Authoring Quantina menu packs

A **menu pack** turns a quantum circuit into an order: N menu items are encoded
as the binary measurement outcomes of ⌈log₂ N⌉ qubits, a visitor builds a
circuit until the histogram peaks on the item they want, and one "serve" samples
the live distribution to pick what comes out (see [`quantina.md`](quantina.md)
for the concept). Packs are **data, not code** — a folder with a `pack.toml` and
a few images — so events, classrooms, and bars can ship their own menu without
rebuilding the app.

This guide covers custom packs: the TOML schema, the encoding rules, images,
theme/links, dispatch payloads, and where to drop the folder on a booth host.
The five bundled built-ins (`coffee`, `cocktails`, `icecream`, `juice`, `demo`)
already ship in the app and need no files. Their ids are **reserved**: clients
resolve a built-in id from the bundle first, so a custom pack that reuses one
(say `cocktails`) would be silently shadowed — always pick a fresh id.

## The `pack.toml` schema

A pack lives in `menu/<id>/pack.toml` on the host (see "Where it goes" below).
The directory name **must equal** the `id` — a mismatch rejects the pack. Here
is a fully commented example (a `subset`-mode cocktail bar):

```toml
id      = "quantum-bar"            # lowercase [a-z0-9-]; must match the dir name;
                                   # built-in ids (coffee, cocktails, …) are reserved
title   = "Quantum Bar"            # shown as the menu heading
tagline = "Mix your drink with a quantum computer"   # optional footer line

[serve]                            # optional; default mode = "single"
mode  = "single"                   # "single" | "shots" | "subset"
shots = { min = 1, max = 5, default = 3 }   # mode = "shots" only; visitor picks
                                            # within these bounds (max ≤ 20)

[theme]                            # optional branding overrides
accent     = "#e91e63"             # a CSS colour for the menu accent
background = "bar.jpg"             # plain filename in the pack dir
logo       = "logo.svg"            # plain filename in the pack dir

[[link]]                           # optional footer links (repeat the block)
name = "IBM Quantum"
url  = "https://www.ibm.com/quantum"

[[item]]                           # one block per menu item (repeat)
code     = "000"                   # single/shots modes: the outcome bitstring
name     = "Tropical Sunrise"
subtitle = "orange · mango · grenadine"
emoji    = "🍹"                    # fallback glyph when no image (always give one)
image    = "sunrise.jpg"           # optional; plain filename in the pack dir

[item.program]                     # optional dispatch payload (QN4; Home Connect)
key     = "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"
options = [{ key = "ConsumerProducts.CoffeeMaker.Option.FillQuantity", value = 50 }]

# … one [[item]] block per code (or per qubit, in subset mode)
```

In `subset` mode an item names a `qubit` instead of a `code`:

```toml
[serve]
mode = "subset"

[[item]]
qubit = 0                          # this ingredient's qubit (0..N-1)
name  = "Gin"
emoji = "🍸"
```

Field names map 1:1 to the wire schema (`shared/menu/pack.ts`); the host serves
each pack as JSON at `/api/menu/pack/{id}`, rewriting image filenames to URLs.

## The encoding rules

The loader enforces these (the client re-validates every pack, so a broken pack
falls back to the built-in `coffee` menu rather than crashing):

- **`single` / `shots`** — `2 ≤ items ≤ 32`. The qubit count is
  `ceil(log2 N)` (floor 1). Each `code` is a **unique bitstring of that width**.
  The **leftmost character is q0** (the top wire) — the exact convention the
  RESULTS histogram labels use, so a peaked column and its menu card share a
  bitstring.
- **`subset`** — `2 ≤ items ≤ 5`. Each item binds to a unique `qubit`, and the
  qubits must be exactly `0..N-1`. A single shot's bitstring selects the subset:
  every set bit is an ingredient in the glass. Superposition = "maybe"; an
  entangled pair = ingredients that always (or never) arrive together — the best
  entanglement demo in the family.
- **Auto-padding** — a `single`/`shots` pack SHOULD fill all `2^q` codes;
  unfilled codes are auto-padded with a "Surprise me ✨" house item. This is the
  honest answer to leftover amplitude: the measurement is the measurement, never
  re-rolled or remapped. You can leave gaps deliberately.
- **`shots` bounds** — `min ≤ default ≤ max`, `min ≥ 1`, `max ≤ 20`. A serve
  draws `k` independent shots (k scoops, duplicates welcome).
- **Codes vs qubits** — `code` is only valid in `single`/`shots`; `qubit` only
  in `subset`. Mixing them is rejected.

Quick code table (leftmost char = q0):

| N items | qubits | codes                          |
| ------- | ------ | ------------------------------ |
| 2       | 1      | `0` `1`                        |
| 3–4     | 2      | `00` `01` `10` `11`            |
| 5–8     | 3      | `000` … `111`                  |
| 9–16    | 4      | `0000` … `1111`                |
| 17–32   | 5      | `00000` … `11111`              |

The default and sweet spot is **3 qubits / 8 items** — the UI is tuned for it.

## Images

- Reference images by **plain filename** in the pack dir (`sunrise.jpg`) — no
  paths, no `..`, no absolute paths (rejected for safety). The host serves them
  at `/api/menu/pack/{id}/image/{filename}`.
- Formats: `jpg`, `png`, `webp`, `svg`. Aim for ~512 px square; the cards are
  small and every byte streams to every viewer's phone.
- Images are optional. Every item takes an `emoji`, used whenever there is no
  image — so a pack with zero image files still looks intentional. Give each
  item an emoji even when you supply an image (it's the loading/fallback glyph).

## Theme and links

- `[theme]` overrides the menu's accent colour and (optionally) a `background`
  and `logo` image, all scoped to the menu — the event's own `branding.toml`
  topbar stays separate and composes on top.
- `[[link]]` blocks become footer links (name + url). Repeat the block for more.

## Program payloads (dispatch)

`[item.program]` is an optional payload carried for **machine dispatch** (phase
QN4). It uses the Home Connect program shape — a `key` plus an `options` list of
`{ key, value }` — and is passed through untouched to the `served` event, where
a dispatch adapter (log / webhook / Home Connect) can act on it. Packs that
never actuate a machine can omit it entirely; the field is inert until QN4.

## Where it goes, and how to verify

Drop the folder next to the other host config files, under the host's config
directory (`~/.qamposer-physical/` by default, or wherever `QAMPOSER_CONFIG_DIR`
points):

```
~/.qamposer-physical/
  branding.toml
  layout.toml
  menu/
    quantum-bar/
      pack.toml
      bar.jpg
      logo.svg
      sunrise.jpg
```

No rebuild and no restart of the app bundle is needed — the host reads the
directory per request. To verify:

1. `curl -s https://<booth-host>/api/menu/packs` — your pack's `id` and `title`
   appear in the list. If it's missing, the host logged a warning saying why
   (id/dir mismatch, malformed TOML, a bad image reference).
2. `curl -s https://<booth-host>/api/menu/pack/quantum-bar` — the full wire
   JSON, with image filenames rewritten to `/api/menu/pack/quantum-bar/image/…`
   URLs.
3. Open `/debug` (operator), switch mode to **quantina**, and find your pack in
   the Quantina card's picker — custom packs show a dashed outline and a `·host`
   suffix. Select it; the kiosk and viewer phones pick it up live.

## Hosting a pack anywhere (`?menupack=`)

You don't need a booth host to try a custom menu. Host the **wire-schema JSON**
(the shape of `/api/menu/pack/{id}`, image URLs already absolute) anywhere that
serves it with permissive CORS, then open the standalone app with a `?menupack=`
URL param:

```
https://entangible.org/?menupack=https://example.org/my-pack.json
```

The app fetches, validates, and applies it for that session only (it is never
persisted). A fetch or validation failure shows a small inline note and keeps
the fallback menu — nothing to install.

## Checklist

- [ ] Directory name equals the `id` (lowercase `[a-z0-9-]`), and the id is not
      one of the reserved built-ins.
- [ ] `serve.mode` chosen; `shots` packs set `{min ≤ default ≤ max}`, `max ≤ 20`.
- [ ] Item count in range (2–32 for single/shots, 2–5 for subset).
- [ ] `code`s are unique bitstrings of the right width (leftmost char = q0), or
      `qubit`s are exactly `0..N-1` for subset.
- [ ] Every item has an `emoji`; any `image` is a plain filename in the dir.
- [ ] Images are ~512 px, jpg/png/webp/svg.
- [ ] Optional `theme` / `[[link]]` / `[item.program]` well-formed.
- [ ] Verified via `/api/menu/packs`, `/api/menu/pack/{id}`, and the `/debug`
      Quantina picker.
