# geo-runtime

**The `.geo` binary is the runtime.** Not a format an engine reads — the thing
that executes. Rust/WASM hosts it, WebGL2 displays it.

**Sprint 0** · the instrument — a scoreboard exists before the engine does.
**Sprint 1** · the slice — the dummy renders from the `.geo` binary, posed,
at three angles, **10.2× faster than GeoV** for the same 5,787 vertices.

**v0.1** · a `hand` may carry a **profile**, so a foot that moves can be the
slab boot it looks like. Additive — no header change, no part-record change, and
every v0 program still compiles to the same bytes. See
[the spec](docs/GEO-V0-SPEC.md#v01--a-hand-may-carry-a-profile) and
`node bench/joint.mjs`, which measures the fix rather than describing it.

## Build and run

One command, and a board at the end:

    ./test.sh

**Nothing is required to prove the bound.** `geokernel.wasm` imports nothing —
no clock, no log, no allocator, no random — so the VM runs in bare Node, and a
built kernel is committed. Straight out of a clone, with no install of any kind:

    node bench/fuzz.mjs      # 4,000 mutated programs · ~2s · no browser, no cargo

The other gates need one of two prerequisites. `./test.sh` **skips them with a
stated reason and exits 3** rather than failing, and the board counts a skip
separately — it will not print "ALL GREEN" while a gate did not run.

| gate | needs | why it needs it |
|---|---|---|
| `unit` · `build` | cargo + `wasm32-unknown-unknown` | rebuilds the kernel from Rust source |
| `validate` | headless chromium | the reference side is GeoV's own `gcBuildForm`, which is browser code |
| `sprint1` | headless chromium | real layout, a real mouse, three angles |
| `instrument` | headless chromium | WebGL2 and the raster clock |

    npm install && npx playwright install chromium        # the [browser] gates
    # rustup: https://rustup.rs                           # the [cargo] gates
    rustup target add wasm32-unknown-unknown

`GEO_CHROMIUM=/path/to/chrome` overrides browser discovery if you already have one.

Gates individually:

    ./build.sh               # cargo → wasm → dummy.geo → dist/index.html
    node bench/validate.mjs  # the VM vs GeoV itself. THE CORRECTNESS GATE.
    node bench/fuzz.mjs      # the bound, tested against 4,000 mutated programs
    node bench/sprint1.mjs   # the rig: reachability, three angles, the number
    node bench/run.mjs       # sprint 0's pipe sweep and chart
    node bench/joint.mjs     # DOES THE FOOT STAY ON THE LEG? frame by frame
    node tools/render.mjs    # SEE it — a software render, no browser, no deps
    node tools/render.mjs bench/reference/v36-test-character-boots.geocast --gif --fps 10

Open `web/rig.html` for the rig, `web/index.html` for the Sprint 0 instrument.

`dist/index.html` is a single double-clickable file with the kernel inlined —
open it in any browser, no server. The module graph in `web/` is the source;
the single file is a build artifact, not a constraint.

## Sprint 1 — the numbers

| | |
|---|---|
| the `.geo` program | **2,320 bytes** — 9 parts, 3 poses, 4 beats |
| the mesh it expands to | 305 KiB · 5,787 verts · 10,600 tris · **135×** |
| `geo_build` | **0.20 ms** mean, 0.21 ms worst |
| GeoV `gcBuildForm`, same mesh | 1.960 ms |
| | **10.2× faster**, and the gate the plan named was 1.93 ms |
| validation | identical to GeoV at 14 times along the plan · 0 index mismatches |
| the bound | 4,000 mutated programs · 736 accepted and executed · 0 traps, 0 overruns |

⭐ **Every frame lands exactly on the header's declared ceiling** — the bound is
derived from the part counts, so it is tight rather than padded.

## What is proven here

| | |
|---|---|
| the bridge | Rust arena → `Float32Array` view over linear memory → `gl.bufferData` → WebGL2. **No copy anywhere.** |
| zero imports | `WebAssembly.instantiate(bin, {})`. No wasm-bindgen, no wasm-pack, no glue. The harness asserts the import count is 0. |
| the bound | `max_verts()` is known before execution; every build is checked against its own stated bound; `overflow_count()` is the alarm if one is ever wrong. |
| no growth | linear memory never grows, so the view can never detach — and the harness **reproduces the detach deliberately** to show the alarm fires. |
| it drew | pixel coverage is measured, not assumed. |

## The two clocks

- **CPU** — build · view · upload · submit. Real, and what the engine owns.
- **RASTER** — `EXT_disjoint_timer_query_webgl2`. Honest, but **software
  rasterised** (SwiftShader) in the bench container: a regression signal, never
  an absolute claim about anyone's GPU.

⚠ **`gl.finish()` is not a synchronisation point here** — measured at 0.02 ms
against a draw that actually costs 200 ms. It is on no measured path in this
repo. Draw submission is asynchronous and unbounded, so the harness drains with
a 1×1 `readPixels` between phases; without that, benchmarking submission queues
hundreds of full-scene draws and starves every measurement after it.

⚠ The page clock is clamped to **100 µs**. Every phase is batched above it, and
the authoritative phase split is taken **inside** the frame rather than inferred
from separately benched pieces — otherwise quantisation looks exactly like a
missing phase.

## Layout

    crates/geokernel/src/
      arena.rs   the bounded arena. Permanent architecture.
      hello.rs   sprint 0's payload. No GeoV content. RES is THE constant.
      mesh.rs    the geometry pass, validated byte-for-byte in BENCH-002.
                 Sprint 1 drives it from the .geo ISA.
    web/
      src/bridge.js   the zero-copy contract and the detach alarm
      src/gl.js       WebGL2, seeded from GeoV's stageGL() shape
      src/runtime.js  build → view → upload → submit, and the clock on each
      index.html      the dev surface / HUD
    bench/
      run.mjs         the instrument
      chart.mjs       the chart, rendered from results, never hand-edited
      results/        latest.json · history.json · chart.svg · frame.png

## Sprint 0's done-when

> Change one constant in the Rust source, rebuild, and the chart moves without
> anyone touching the harness.

`hello::RES` is that constant. `run.mjs` reads it **out of the wasm** — the
harness is never told what it was built from, it asks.

## The MCP server — six tools, no browser

    node mcp/install.mjs     # register with Claude Desktop
    node mcp/smoke.mjs       # spawn it and call every tool over real stdio

`geokernel.wasm` imports nothing, so the server runs anywhere Node runs.

| tool | answers |
|---|---|
| `geo_compile` | a `.geocast` → a `.geo` program: size, counts, and the ceiling |
| `geo_build` | build at one or more plan times — verts, ceiling, overflow, memory growth |
| `geo_validate` | the bound, at hostile times including outside the plan |
| `geo_bench` | `geo_build` timed, **with its noise floor printed beside it** |
| `geo_inspect` | a header, read without executing anything |
| `geo_render` | ⭐ **the picture, and the MOTION** — a z-buffer software rasteriser and a GIF encoder, both in pure Node |

⚠⚠ **MCP does not make tokens cheaper.** An argument is a token wherever it
arrives. What is cheap is the *shape*: a statement in, a **summary** out. Every
tool refuses to return a mesh buffer — `geo_build` produces 46,296 floats and
reports eight numbers. `geo_render` is the one deliberate exception, and it
returns a rendered picture, never geometry.

⭐ **The five that answer in numbers could not SEE.** A wide contact sheet said
"the legs never move"; a windowed render of the same program showed a leg
lifting and its boot staying behind. **Print the number beside the picture** —
`geo_render` lists every frame's vertex count for exactly that reason.

⭐⭐ **And a sheet still only shows you moments.** `gif: true` draws ONE LOOP of
the plan — frame count from `fps × plan_end`, sampled *exclusive* of the end so
the seam does not stutter. `tools/gif.mjs` is GIF89a with LZW and a palette
built from the frames themselves, in **~170 lines and no dependencies**, same
rule as the PNG encoder beside it: *if the proof needs a library nobody has, it
is not a proof.* An animation is written to disk and **not** inlined — a model
sees one still of it and pays for the whole file; the GIF is for a person.

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — what was built, the one idea it
  rests on, how the bound is enforced, every decision and what it cost, where the time
  actually goes now, and a closing section on what is *not* proven.
- **[docs/COMPETITIVE-BRIEF.md](docs/COMPETITIVE-BRIEF.md)** — where `.geo` sits against
  Rive, Spine, glTF (+ `KHR_interactivity`), Lottie and Three.js. Honest about where each
  of them wins, which is most rows.
- **[docs/GEO-V0-SPEC.md](docs/GEO-V0-SPEC.md)** — the format, including every rejection
  code and what the ISA refuses to encode.
