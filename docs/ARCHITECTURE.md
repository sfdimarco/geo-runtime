# geo-runtime — architecture

**The `.geo` binary is not an asset an engine loads. It is the thing that
executes.** A 2,320-byte program describes a character; a 59,732-byte WASM
kernel expands it into a 305 KiB mesh, at 0.20 ms a frame, into memory the GPU
reads directly. There is no scene graph, no allocator, no import table, and no
step where the decoded output is copied into a draw buffer — because the decode
output *is* the draw buffer.

This document explains what was built, the one idea it is built on, what has
been proven and by what instrument, and — at the end, deliberately — what has
not.

---

## 1 · The claim, measured

The predecessor, **GeoV v36**, is a 1 MB single-file JavaScript editor that has
shipped real work. It is the oracle here, not a straw man: every correctness
check compares against v36's own `gcBuildForm` running in the same JS context on
the same input.

| | GeoV v36 (JS) | geo-runtime (Rust/WASM) | |
|---|---|---|---|
| build the same 5,787-vertex character | 1.960 ms | **0.195 ms** mean · 0.265 ms worst | **10.0×** |
| the program that describes it | — | **2,320 bytes** | |
| the mesh it expands to | — | 305 KiB · 10,600 tris | **135× expansion** |
| kernel size | ~1 MB page | **59,732 B**, 0 imports | |
| geometry identical to the oracle | — | 14 times along the plan, 0 index mismatches | worst Δ **8.2e-7** (6.9 ULP) |
| linear memory growth across a run | — | **0 pages** (257 → 257) | |

The gate the build plan named ahead of time was 1.93 ms. Worst case came in at
0.265 ms.

### The intermediate result that matters more than the headline

Before writing any Rust, three variants of the same geometry pass were measured
against each other (`bench/baseline/`):

| | ms | |
|---|---|---|
| **A** — GeoV as it ships today | 1.960 | the baseline |
| **B** — the same JS, writing into a preallocated typed arena | 0.553 | **3.5×**, no language change |
| **C** — Rust/WASM over the same arena | 0.187 | **10.5×** |

**Two-thirds of the win was the memory discipline, not the language.** Variant B
is one afternoon of work inside the existing JS engine and it was never refused;
it is on the table as a cheap alternative to everything below. The rebuild was
chosen for what the *format* enables, not for the extra 3×, and stating that
plainly is part of the result.

---

## 2 · The one idea

> **A bounded FSM and zero-copy are the same constraint seen from opposite ends.**

A depth-*D* quadtree has at most (4^(D+1) − 1)/3 nodes. That number is knowable
*before execution*. The same is true of every surface primitive here: a loft at
resolution *nu × nv* costs exactly (nu+1)(nv+1) vertices, and the header declares
the counts. So the arena can be sized before a single instruction runs.

And if the arena is sized before execution, then:

- there is no `Vec`, because nothing can grow;
- there is no allocator, because nothing is allocated;
- there is no `memory.grow`, because linear memory never moves;
- and therefore **a JavaScript `Float32Array` view over that memory can never
  detach.**

That last one is the payoff. Every WASM/JS graphics bridge has the same footgun:
you take a typed-array view over linear memory, memory grows, your view silently
detaches, and you upload zeroes. The usual fix is to re-derive the view every
frame and hope. Here the fix is structural — the bound removes the growth, and
the growth is what detaches the view.

The second half of the idea is layout:

> **The decode output is the draw input.**

The arena's interleave is `pos3 · uv2 · nrm3` — 8 floats, 32 bytes, the exact
stride `gl.bufferData` wants. Nothing is repacked on the way out. `mesh_ptr()`
returns a byte offset; JS makes one view over it; that view goes straight to the
GPU.

```
        .geo program                 WASM linear memory                 GPU
        (2,320 bytes)                (257 pages, fixed)

   ┌──────────────────┐        ┌──────────────────────────┐
   │ header  · bounds │───────▶│ BIN[]  the program       │
   │ parts   · poses  │        ├──────────────────────────┤
   │ beats   · plan   │        │ VBUF[] pos3 uv2 nrm3 ────┼────▶ gl.bufferData
   └──────────────────┘        │ IBUF[] u32 indices    ───┼────▶ (no copy,
                               │ GROUPS[] per-part spans  │       no repack)
                               └──────────────────────────┘
                                  ▲ ceiling fixed at load
                                  │ every write bounds-checked
                                  │ overflow COUNTED, never silent
```

---

## 3 · The bound is checked three times, not asserted once

A bounded system that overflows quietly is worse than an unbounded one, because
it produces confident wrong numbers. So the ceiling is enforced at three
independent points, and the third one is an alarm rather than a guard:

1. **At load.** `geo_load()` derives the vertex and index ceiling from the
   header's part counts and resolutions and refuses the program if it exceeds
   the arena — return code `−5`. A load that returns 0 is a *guarantee* that
   every later `geo_build` fits.
2. **Every frame.** The JS bridge re-checks the declared ceiling on each build
   rather than trusting the load once.
3. **At every write.** `arena::push` and `arena::quads` refuse past the end and
   increment an exported `OVERFLOW` counter. The harness fails the run if it is
   ever non-zero. It never has been.

The bound is also **tight, not padded**: every frame lands *exactly* on the
header's declared ceiling, because the ceiling is derived from the same counts
the builder walks.

### The hole the fuzzer found

`max_verts_from_header` originally multiplied `n_solids × nu × nv` in `usize`.
On `wasm32`, `usize` is **32 bits**. A header declaring 65,535 solids at 255×255
wraps that product onto a *small* number — which then passes the arena check.
A bounded VM talked out of its own bound by arithmetic.

The fix is saturating arithmetic throughout, and the regression test
(`tests.rs::grid_bounds_saturate_instead_of_wrapping`) asserts *totality*: no
input panics and none wraps, including `usize::MAX`. The first attempt at that
fix saturated the multiply and left `nu + 1` able to overflow — which panics in
debug and wraps silently to zero in release, giving a ceiling of *nothing* that
passes every check below it. The unit test caught that too.

---

## 4 · Unify by restriction

`.geo` v0 has **no encoding** for `CALL`, `PROG`, `PLURALITY`, `tick`, `EMIT`,
or any jump. This is the design, not a gap.

The compiler (`tools/geocast-to-geo.mjs`) reads GeoV's `.geocast` authoring
format and *refuses* anything the ISA cannot express — throwing an error that
**names the offending key** rather than silently dropping it. `POSE_KEYS` is the
complete list of what a pose may carry: `from, mid, to, w, taper, off`. Anything
else stops the build.

The reason is the bound. Any construct that can branch or call is a construct
whose vertex cost cannot be computed from the header. Admit one jump and the
guarantee in §2 evaporates. So the format is defined by what it refuses, and
every refusal is loud.

---

## 5 · What is proven, and by what

`./test.sh` runs six gates in ~90 s and exits non-zero on any failure. Each gate
logs to `bench/results/test-log/`.

| gate | what it proves | result |
|---|---|---|
| **unit** (11 tests, ~1 s) | the logic that can be wrong *silently*: profile endpoints and clamping, bounds totality, every `load()` rejection code, determinism under NaN/±∞/±1e30, an unloaded VM emitting nothing, the arena counting instead of overrunning | pass |
| **build** | cargo → wasm32-unknown-unknown → `.geo` asset → single-file `dist/` | pass |
| **validate** (~5 s) | the VM against **GeoV's own `gcBuildForm`**, both running in one JS context, at 14 times along the plan including the beat boundary at 2.599/2.600 | identical vert/index/group counts · **0** index mismatches · worst Δ 8.2e-7 |
| **fuzz** (~2 s) | the bound against 4,000 mutated programs across 9 strategies (byte-flip, header, counts, resolutions, offsets, ceiling, truncation, float storms, noise) | 736 accepted and executed · **0 traps · 0 overruns · 0 memory growth** |
| **sprint1** (~20 s) | reachability, three posed angles, and the number, in headless Chromium under SwiftShader | 9/9 |
| **instrument** (~62 s) | the Sprint 0 pipe sweep and chart, with its own noise floor printed | pass |

### Reachability is a gate, because "present" is not "reachable"

GeoV v36 shipped a DEPTH slider that was on screen, unclipped, and **covered by
the next panel** — for months. Every clipping test passed it, because nothing
was clipped.

The rebuilt rig reproduced that failure on day one. All three sliders:
`hit = FALSE, covered by: nothing` — below the fold, in a brand-new HUD, three
lines under a CSS comment citing the old failure. It was worse than that:
Playwright's `boundingBox()` auto-scrolls, so the *drag test alone would have
shipped it*.

The fix was to the layout — the control deck is pinned in a
`grid-template-rows: auto minmax(0,1fr) auto` and cannot scroll out of reach —
and the harness now runs `document.elementFromPoint(centre)` on **every** control
at **three** window sizes, plus a real mouse drag that must move the value *and*
its readout.

> A hazard you can only assert is a hazard you will meet again. The only closure
> is reproduction.

The same principle closed the detached-view footgun: `__test_grow()` exists
solely so the harness can grow linear memory *on purpose* and prove the alarm
fires. It is never called on the runtime path.

---

## 6 · Where the time actually goes now

Publishing the loss as loudly as the win: **`geo_build` is no longer the
bottleneck, and the thing that replaced it is bigger than it was.**

Measured inside the frame, over 60 frames, at t = 0:

| phase | ms | share of CPU frame |
|---|---|---|
| `geo_build` (wasm) | 0.185 | 14% |
| view / matrices | 0.000 | 0% |
| **`gl.bufferData` upload** | **1.142** | **84%** |
| submit | 0.033 | 2% |
| **CPU total** | **1.360** | |

The build got 10× faster and is now a rounding error next to the upload of the
same 305 KiB. The next honest win is not more decode speed — it is not
re-uploading a buffer whose topology never changes, and uploading only the
vertex block that the pose actually moved. That work is named and not yet done.

Two further caveats stated rather than buried:

- **The raster numbers are software.** The GPU clock reads ~26 ms/frame under
  SwiftShader in headless CI. That is a rasteriser measurement, not a claim about
  real hardware, and it is labelled *software* in the HUD itself.
- **The instrument has a noise floor**, and it is printed next to every delta:
  ±7% on build, up to ±83% on the smallest phases, measured across five runs of
  the *same binary*. A "+166% cpu" delta once looked like a regression and was a
  Tuesday.

---

## 7 · Decisions, and what each cost

| decision | why | what it cost |
|---|---|---|
| **Ground-up rebuild, not a strangler** | The format only earns its keep if the runtime is built around the bound. A typed arena bolted into v36 (variant B) gets 3.5× and keeps every structural constraint. | Variant B was cheaper and was never refused. This is a bet on the format, and it should be read as one. |
| **No `no_std`** | `sin`/`cos`/`sqrt` come from libm via `std` on wasm32. | ~15 KB. Measured, accepted. |
| **No wasm-bindgen / wasm-pack** | A `cdylib` with `extern "C"` exports over a static arena *is* the bridge. Zero imports means `WebAssembly.instantiate(bin, {})`. | Manual pointer bookkeeping in JS. Worth it: the import table is the surface where a "zero-copy" claim usually stops being true. |
| **f64 pose arithmetic, f32 storage** | The first port did pose math in f32 and drifted 2.578e-6 (21.7 ULP) from the oracle. Widening to f64 brought it to 8.196e-7 (6.9 ULP). | The remaining floor is the format's own f32 storage. That is a stated cost, not a bug. |
| **Front face is CW, culling stays ON** | The arena emits `(a,c,b)(b,c,d)` — byte-identical to GeoV's `gcQuads`, which winds CW. | Culling could have been disabled to make the first render appear. Leaving it on means an inside-out surface is caught the same day instead of shipping. |
| **`static mut` everywhere** | The kernel is a single-threaded arena machine; there is no ownership story to model. | Every unit test that touches the arena serialises on one `Mutex`, or cargo's thread pool races them into nondeterministic failures — the worst kind of test. |
| **Prune, never park** | The flat `OPS` array that drove the mesh pass during benchmarking was **deleted** when `.geo` replaced it, not disabled behind a flag. | Nothing. Dead paths that still compile are how a codebase acquires two truths. |

One bug in this list is mine and worth naming: an early `resolve()` read the
limb's `seat` from a **global** the caller had to remember to set. That is
fail-open — the same shape as a pose that silently does not apply. It became a
parameter before it spread.

---

## 8 · Map

```
crates/geokernel/src/
  arena.rs    the permanent arena · STRIDE 8 · 262,144 verts · 1,572,864 idx
              push() and quads() refuse past the ceiling and COUNT the refusal
  geo.rs      the .geo v0 VM · reads the bytes directly every frame,
              no decoded-instruction cache · load() → 0 or −1…−7
  mesh.rs     loft · sweep · noodle · mitt · leaf · 7 closed-form profiles
              resolutions are PARAMETERS from the header, never constants
  hello.rs    Sprint 0's payload — the pipe, with no GeoV content in it
  lib.rs      the whole bridge: extern "C" over pointers into the arena
  tests.rs    11 unit tests · the gate a commit has to pass

tools/
  geocast-to-geo.mjs   the compiler. Refuses what the ISA can't express,
                       and names the key it refused.
  compile-asset.mjs · bundle.mjs

web/src/
  bridge.js   Kernel · re-derives views only on ArrayBuffer identity change
              and counts `detaches` as an alarm · checks the ceiling per frame
  gl.js       Stage · per-part group draws · drain() · the value-pass shader
  runtime.js  Sprint 0 surface     rig.js  Sprint 1 surface

bench/
  validate.mjs   THE CORRECTNESS GATE — the VM vs GeoV in one JS context
  fuzz.mjs       4,000 mutated programs, seed 20260903
  sprint1.mjs    reachability × 3 sizes · three angles · the number
  run.mjs        Sprint 0's pipe sweep, and its own noise floor
  reference/     geov-v36.html — the oracle, not a convenience copy

docs/GEO-V0-SPEC.md   the format, including every rejection code
```

## 9 · Run it

```
./test.sh          # all six gates, ~90 s, non-zero exit on any failure
./test.sh quick    # stops after fuzz (~10 s)
./build.sh         # cargo → wasm → dummy.geo → dist/index.html
```

Open `web/rig.html` for the rig, `web/index.html` for the Sprint 0 instrument.
`dist/index.html` is a single double-clickable file with the kernel inlined —
no server. The module graph in `web/` is the source; the single file is a build
artifact, not a constraint.

---

## 10 · What is *not* proven

Stated here rather than left for a reader to discover:

- **`gcLeaf` is implemented and never exercised** by the test character. It has
  no oracle comparison behind it.
- **The bound is declared, not derived from a tree.** §2 argues from the quadtree
  ceiling, but v0's bound comes from part counts and resolutions in the header.
  The general claim is not yet the implemented claim.
- **The draw path uses `col_a` only.** The VM emits both group colours; GeoV's
  split fill is the PLATE layer and is not in this slice.
- **Raster numbers are software** (SwiftShader), as above.
- **One character, one plan.** Correctness is proven against a single 9-part
  test character at 14 times. It is a deep check of a narrow input.
- **Variant B (typed arena inside v36) was never refused** — 3.5× for an
  afternoon, no format, no rewrite. It remains the honest cheap alternative.
