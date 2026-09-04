# geo-runtime

**The `.geo` binary is the runtime.** Not a format an engine reads — the thing
that executes. Rust/WASM hosts it, WebGL2 displays it.

**Sprint 0** · the instrument — a scoreboard exists before the engine does.
**Sprint 1** · the slice — the dummy renders from the `.geo` binary, posed,
at three angles, **10.2× faster than GeoV** for the same 5,787 vertices.

## Build and run

    ./build.sh               # cargo → wasm → dummy.geo → dist/index.html
    node bench/validate.mjs  # the VM vs GeoV itself. THE CORRECTNESS GATE.
    node bench/fuzz.mjs      # the bound, tested against 4,000 mutated programs
    node bench/sprint1.mjs   # the rig: reachability, three angles, the number
    node bench/run.mjs       # sprint 0's pipe sweep and chart

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

## Documentation

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — what was built, the one idea it
  rests on, how the bound is enforced, every decision and what it cost, where the time
  actually goes now, and a closing section on what is *not* proven.
- **[docs/COMPETITIVE-BRIEF.md](docs/COMPETITIVE-BRIEF.md)** — where `.geo` sits against
  Rive, Spine, glTF (+ `KHR_interactivity`), Lottie and Three.js. Honest about where each
  of them wins, which is most rows.
- **[docs/GEO-V0-SPEC.md](docs/GEO-V0-SPEC.md)** — the format, including every rejection
  code and what the ISA refuses to encode.
