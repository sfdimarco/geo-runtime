# `geo-runtime` as an MCP server

**Nine tools. No browser. No cargo. Node and a clone.**

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
| `geo_render` | a program + times, an optional camera window, or `gif:true` | a PNG contact sheet (optionally inline) or an on-disk animated GIF, plus per-frame vertex counts and ceiling compliance |
| `geo_ab` | two to four labelled casts + times, or `gif:true` | a labelled comparison sheet or animation in one shared frame, with per-frame vertex counts; **no verdict** |
| `geo_sweep` | a cast, one existing dotted-path axis, and values to try | a labelled contact sheet with the unmodified reference pinned by default and refused values shown as **REFUSED** tiles |
| `geo_look` | a program + times, or `shots` (one camera window per frame) | **Jev's** typed answers about every frame — empty? where? cut off by the frame? one object? — each beside a **code measurement of the same grid** and `agrees` |

### `geo_look` — the decision layer
Renders frames through the same rasteriser as `geo_render`, turns each into a GEO quadtree **flattened to a
16×16 colour-word grid**, and asks [Jev](https://vercel.com/ai-gateway/models/jev) (TypeSafe's System One model,
via the Vercel AI Gateway) typed questions about all of them in **one** call.
- **Why a flattened grid:** measured 2026-09-26, Jev read this grid at 18/18 for placement and 20/22 for 2-D
  grouping; it could **not** read the raw quadtree nesting (8/18).
- **Every preset carries its own control.** The code measures the same grid, so you see Jev calibrated on your
  own frames. First live runs: 16/16 on auto-fit frames, **22/24** on a six-shot storyboard with off-centre,
  cut-off and empty shots — both misses on one shot, both at low confidence (0.40, 0.29). **Treat `p` < 0.6 as unsure.**
- **Custom questions have no control** — they are a judgement. "Is this a standing figure?" came back p ≈ 0.53: a coin flip.
- **One answer per ~5 minutes** on this account (TypeSafe's limit). A rate-limited call returns fast with the grids and `retry_in_s`.
- The key is read from `AI_GATEWAY_API_KEY`, `GEO_JEV_ENV`, or `../jev-lab/.env.local` — never stored in this repo. `dry_run:true` needs no key.

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

**The GeoV bridge.** These nine tools drive the *runtime*. They do not touch
GeoV Studio, so they do not yet solve the authoring problem — poses, shots, and
line work still go through the UI.

That is group two, and it is **files, not the DOM**: `buildProjectData()` /
`openProjectData()` already round-trip, and `tools/geocast-to-geo.mjs` already
compiles a cast. The file is already the interface.

⚠ When it lands, the drawing tools must take **the pen grammar** —
`pen().to().bez().arc()`, a handful of numbers — and never a point list.
Cheap drawing comes from the grammar, not the transport. A `draw_stroke` that
takes 400 points would miss the entire point of building this.
