# `geo-runtime` as an MCP server

**Five tools. No browser. No cargo. Node and a clone.**

    npm install
    node mcp/smoke.mjs      # spawns the server, calls every tool, prints a board

## Why

Every entry point into this runtime was built for **one small change at a
time** — nudge a slider, scrub a frame, set a key. A ninety-second film took
**577 keyframes**, and four operations had to bypass the interface entirely:
publishing a code clip into the live page, reading functions back out of it with
`String(window.fn)`, and screenshotting to find out what happened.

An MCP server makes the unit of work a **document instead of a gesture.**
`geo_compile` takes a whole `.geocast` and returns the ceiling. `geo_build`
takes a program and a list of plan times and returns whether every frame stayed
inside it. The answer comes back as **data, not a screenshot** — so a model can
check its own work, and a wrong result is a number rather than a picture someone
has to look at.

## ⚠ What MCP does not do

**It does not make tokens cheaper.** An argument is a token whether it arrives
over stdio or in a code clip. The protocol is not a compression layer, and
anyone who builds one expecting that will be disappointed.

What is cheap is the **shape**:

> **A statement in. A summary out.**

`geo_build` produces 46,296 floats and reports eight numbers. A tool that
returned the mesh would cost more than the code clip it replaced. That rule is
the reason this is worth having, and it is enforced in `tools.mjs` — pass
`sample_verts` if you actually need to see vertices.

The real saving is elsewhere and it is large: driving the runtime used to mean
publishing a code clip into a live page, reading functions back out of it with
`String(window.fn)`, and screenshotting to find out what happened. None of that
happens now.

## The tools

| tool | what you say | what comes back |
|---|---|---|
| `geo_compile` | a `.geocast` document, or a path | bytes, part/pose/beat counts, and the **ceiling the header declares** |
| `geo_build` | a program and some plan times | verts, indices, ceiling compliance, overflow, memory growth |
| `geo_validate` | a program | whether the bound held at 15 times, *including outside the plan and at absurd values* |
| `geo_bench` | a program | mean/min/p50/p95 **and the noise floor**, plus an honest speedup with its caveats attached |
| `geo_inspect` | a `.geo` file | the 64-byte header, executed nothing |
| `geo_look` | a program + times, or `shots` (one camera window per frame) — or pictures (`images`), or grids | **Jev's** typed answers about every frame — empty? where? cut off by the frame? one object? — each beside a **code measurement of the same grid** and `agrees` |
| `geo_squint` | the same, nothing sent | the exact 16×16 words the eyes would read, the measurements, the colour-statistics baseline — free and instant |

### `geo_look` — the decision layer
Renders frames through the same rasteriser as `geo_render`, turns each into a GEO quadtree **flattened to a
16×16 colour-word grid**, and asks [Jev](https://vercel.com/ai-gateway/models/jev) (TypeSafe's System One model,
via the Vercel AI Gateway) typed questions about all of them in **one** call.
- **Why a flattened grid:** measured 2026-09-26, Jev read this grid at 18/18 for placement and 20/22 for 2-D
  grouping; it could **not** read the raw quadtree nesting (8/18).
- **Every preset carries its own control.** The code measures the same grid, so you see Jev calibrated on your
  own frames. First live runs: 16/16 on auto-fit frames, **22/24** on a six-shot storyboard with off-centre,
  cut-off and empty shots — both misses on one shot, both at low confidence (0.40, 0.29). **Treat confidence < 0.65 as unsure.**
- **Custom questions have no control** — they are a judgement. "Is this a standing figure?" came back p ≈ 0.53: a coin flip.
- **The gate** — `node tools/gate.mjs <results dir> [--jobs jobs.json]` routes every answer in a folder of results:
  presets → code (the measurement is the answer), sure judgements → Jev, and everything else → eyes (unsure,
  a measured blind spot such as time of day, size or *cut off by the frame* on real film frames, near-black
  frames, a disagreement with your `expect`). One short table, plus `_gate.json` with every answer that needs a look. $0.
- **One answer per ~5 minutes** on this account — measured on the **Vercel route only** (both of its upstream
  providers answered 429 two seconds after a 200). A rate-limited call returns fast with the grids and `retry_in_s`.
- The key is read from the environment, `GEO_JEV_ENV`, or `../jev-lab/.env.local` — never stored in this repo. `dry_run:true` needs no key.

### 👁 The glance (2026-09-28) — everything below is opt-in; the old calls are byte-identical
| arg | what it does |
|---|---|
| `transport` | `auto` (default) · `vercel` · `openrouter` · `typesafe`. **auto takes the first key it finds: `OPENROUTER_API_KEY`, then `TYPESAFE_API_KEY`, then `AI_GATEWAY_API_KEY`.** OpenRouter and TypeSafe speak TypeSafe's own shape (`noul`, not `boolean`); it is translated both ways, so replies look the same whichever route ran. |
| `images` | **the image door** — 1–8 PNGs (film frames, drawings), each squashed whole to the grid. `legend: 'scene'` for a whole scene (then `presets: []` and your own questions). Per image: `expect` (your measured answer = a controlled question), `scramble: <seed>`. |
| `grids` | **the grid door** — 16×16 colour words straight in (a game state, a test pattern). Unknown words are refused by name. |
| `palette` | `kill_switch` (default, the 19 words) · `fine` (+15: cream, beige, peach, salmon, rose, lavender, mauve, plum, navy, slate, teal, mint, light_green, olive, khaki). |
| `control: 'scramble'` | every frame gets a twin `fNs` with **the same words in shuffled places** (seeded). Each answer comes back with `layout_effect` = real − twin. Near 0 = Jev read colour, not layout. Max 4 frames (8 per look). |
| `baseline` | colour statistics of the very grid Jev reads (lum, warmth, sat, busy, top words). On by default for scenes and grids. A judgement is only news where it beats these. |
| **`geo_squint`** | the free half of the eye: the same doors and options, **nothing sent, no key** — the grids, the measurements, the baselines and the sheet. Squint before and after every change. |

**To lose the 5-minute wall:** put ONE of these lines in `jev-lab/.env.local` (the file the Vercel key already lives in):
`OPENROUTER_API_KEY=…` (an OpenRouter account with a few dollars of credit; model `typesafe/jev-1.13`) or
`TYPESAFE_API_KEY=…` (TypeSafe's own API, 1,200 requests/min documented — waitlisted). Nothing else changes; a
dry run shows which route it will take (`transport`). Keep the Vercel key — auto falls back to it.
⚠ The TypeSafe-direct route is built from TypeSafe's published shape but has **not** been called for real (no key yet).

**What the eyes read, measured on SQUARE EYES (calls 04–09):**
- *Colour-mood* (time of day, warmth) is **colour statistics**: scrambling the layout moved time of day by ~0.5 on a
  0–7 scale and warmth by ~0.2 on 0–4. Warmth tracks a palette change reliably; "morning vs midday" it does not
  read at all (both palettes, both versions of the film) — people read sun angle and shadows for that.
- *Relations* are **layout**: two figures side by side vs at opposite edges, identical words — "together" 0.63 vs 0.25.
- *Feelings* from layout are weak: "lonely" stayed 0.28–0.48 whatever the layout. Don't lean on them.
- *Vocabulary matters*: through the 19 words a pastel world is tan / grey / light_grey. `palette: 'fine'` brings back
  light_green, beige, khaki, mauve, navy — and night reads 0.83–0.96 either way.

**Refusal is a correct outcome.** The compiler refuses what the ISA cannot
express and names the key; the VM refuses a malformed program with a numbered
code. Both come back as results, not errors.

⭐ **The ISA's limits are not duplicated in the tool schemas.** The schema
constrains the *type*; the compiler owns the *meaning*. Copying `1..255` into a
zod schema would put the ISA in two places, and the copy is the one that goes
stale.

## Connect it to Claude

Add this to `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "geo-runtime": {
      "command": "node",
      "args": ["D:\\Mook\\Documents\\Claude\\Projects\\.geo\\geo-runtime\\mcp\\server.mjs"]
    }
  }
}
```

For Claude Code:

    claude mcp add geo-runtime -- node /absolute/path/to/geo-runtime/mcp/server.mjs

Any MCP client works — the server speaks the standard stdio transport and
declares only the `tools` capability.

## What is not here yet

**The GeoV bridge.** These five tools drive the *runtime*. They do not touch
GeoV Studio, so they do not yet solve the authoring problem — poses, shots, and
line work still go through the UI.

That is group two, and it is **files, not the DOM**: `buildProjectData()` /
`openProjectData()` already round-trip, and `tools/geocast-to-geo.mjs` already
compiles a cast. The file is already the interface.

⚠ When it lands, the drawing tools must take **the pen grammar** —
`pen().to().bez().arc()`, a handful of numbers — and never a point list.
Cheap drawing comes from the grammar, not the transport. A `draw_stroke` that
takes 400 points would miss the entire point of building this.
