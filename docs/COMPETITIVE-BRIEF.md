# Competitive brief — where `.geo` sits

**Date:** 3 September 2026 · **Audience:** an engineer deciding whether this
work is worth taking seriously · **Shelf life:** short. The interactivity story
below is moving fast.

---

## The one-paragraph version

Every format on this list is an **asset that an engine reads**. `.geo` is a
**program whose memory cost is computable from its header before it runs**, and
the runtime is built around that fact — no allocator, no growth, no repack, a
GPU buffer written once in the layout the GPU wants. No rival has that property,
because every one of them supports branching, and branching is what makes the
cost incomputable. That is the entire differentiation, it is narrow, and it is
real.

It is also the whole answer to "why not just use X?" — because **on every other
axis, X wins.** What follows says so specifically.

---

## 1 · The competitive set

| level | who | why they're here |
|---|---|---|
| **Direct** | Rive (`.riv`), Spine (`.skel`) | Binary formats that carry animation *and behaviour*, with runtimes built to execute them. Rive is the closest philosophical rival. |
| **Indirect** | glTF 2.0 (+ `KHR_interactivity`), Lottie / dotLottie | Interchange formats that solve the same delivery problem a different way. glTF is becoming a direct rival — see §5. |
| **Adjacent** | Three.js, Babylon.js, PlayCanvas | Not formats. General renderers that could host any of this and already host most of it. |
| **Substitute** | **Ship an MP4.** | Not a joke, and it is the incumbent that actually wins most of the time. GeoV's own `SIGNAL.geov` is 2.1 MB against a 345 MB MP4 of the same piece — a 220:1 win the predecessor already banked. The substitute has zero engineering cost and infinite compatibility. |

The honest landscape axes are not "breadth vs depth." They are:

```
                      execution cost knowable before running
                                    ▲
                                    │
                          .geo ●    │
                                    │
   authoring ecosystem ◀────────────┼────────────▶ authoring ecosystem
        (none)                      │                    (deep)
                                    │
                                    │  ● Spine   ● Rive
                                    │  ● Lottie  ● glTF
                                    ▼
                      cost known only at runtime
```

`.geo` is alone in the top-left quadrant. Being alone in a quadrant is only
worth something if the quadrant matters — argued in §4, and honestly bounded in
§7.

---

## 2 · Feature comparison

Rated: **Strong** · **Adequate** · **Weak** · **Absent**. Rated on what these
things actually do today, not on marketing.

| | **.geo** | **Rive** | **Spine** | **glTF 2.0** | **Lottie** | **Three.js** |
|---|---|---|---|---|---|---|
| **Delivery** | | | | | | |
| binary wire format | Strong | Strong | Strong | Strong (GLB) | Weak (JSON; dotLottie zips it) | n/a |
| size for equivalent motion | Strong (2.3 KB → 305 KiB mesh) | Strong | Strong | Adequate (geometry is stored) | Adequate | n/a |
| **Runtime** | | | | | | |
| runtime size | Strong (59.7 KB, **0 imports**) | Strong | Strong | Adequate (loader + engine) | Adequate | Weak (large) |
| platforms shipped | **Weak** (web only) | Strong (web, iOS, Android, Flutter, Unity, Unreal, C++) | Strong (~20 runtimes) | Strong (everywhere) | Strong (everywhere) | Adequate (web) |
| production maturity | **Absent** | Strong | Strong (15+ yrs) | Strong | Strong | Strong |
| **Execution model** | | | | | | |
| behaviour lives in the file | Strong | Strong (state machines) | Adequate (constraints, IK) | Emerging (`KHR_interactivity`, submitted for ratification 16 Jul 2026) | Weak (expressions) | n/a |
| **memory cost known before execution** | **Strong — unique** | Absent | Absent | Absent | Absent | Absent |
| zero-copy decode→GPU | **Strong (structural)** | Adequate | Adequate | Weak (parse, then upload) | Absent | Adequate |
| no allocation on the frame path | **Strong** | Adequate | Adequate | Weak | Weak | Weak |
| **Authoring** | | | | | | |
| designer-facing editor | **Absent** | **Strong** — best in class | Strong | via DCC tools | Strong (After Effects) | Absent |
| ecosystem / asset libraries | **Absent** | Adequate | Adequate | Strong | Strong | Strong |
| **Scope** | | | | | | |
| general 3D (materials, skinning, PBR) | **Absent** | Absent (2D) | Absent (2D) | Strong | Absent | Strong |
| **verified against an oracle** | Strong (14 times, 0 mismatches, Δ 8.2e-7) | — | — | — | — | — |

Two rows in that table are the whole story: **one row `.geo` owns alone, and
five rows where it reads Absent.**

---

## 3 · Where each rival genuinely wins

**Rive — wins on the editor, and the editor is the product.**
`.riv` is a real binary carrying real state machines (major version 7), with
runtimes for web, iOS, Android, Flutter, Unity, Unreal and C++. Designers author
interactive behaviour directly, without a developer in the loop. That is the
hardest problem in this space and Rive solved it. `.geo` has no editor at all;
its authoring path is a compiler that reads GeoV's `.geocast` and *refuses* most
of it. If the question is "how does a designer make interactive motion today,"
the answer is Rive, and it is not close.

**Spine — wins on production trust.**
Fifteen years, ~20 official runtimes, in shipped games across every platform.
Meshes, IK, path constraints, skins, mix-and-match. When a studio needs 2D
skeletal animation to work on Switch on Tuesday, they buy Spine. `.geo` has one
test character validated at fourteen times.

**glTF — wins on universality, and is now moving onto this ground.**
Every DCC tool exports it, every engine imports it, it is ratified, and it has a
real compression story (Draco, meshopt). And `KHR_interactivity` — behaviour
graphs of "operations, events, control flow, and data transformations" that read
and write glTF properties at runtime — was submitted for ratification in July
2026. See §5; this is the important one.

**Lottie — wins on distribution.**
After Effects → JSON → every platform, with an enormous free library. The
technical merits are secondary; the win is that the motion designers already
know it and the assets already exist. Nothing here competes with that.

**Three.js — wins by not being a format.**
Materials, lighting, post-processing, loaders, a WebGPU renderer, and an
ecosystem. `.geo` renders one puppet with one fill colour per part into WebGL2.
Three.js is what you reach for the moment the requirement widens by an inch.

**The MP4 — wins on effort.**
Zero engineering, universal playback, and the file is done. Every argument in
this brief has to beat "just render it out," and for most content it does not.

---

## 4 · The one position nobody else can take

Rive, Spine, and `KHR_interactivity` all put *behaviour* in the file — and
behaviour means branching. Once a file can branch, its memory cost is a function
of runtime state, so the runtime must allocate defensively, grow, or cap
arbitrarily. Khronos names this directly: the interactivity design needs
"safety constraints to prevent infinite loops." That is the shape of the
problem — admit unbounded execution, then fence it.

`.geo` takes the opposite path. **It refuses the jump and gets the bound for
free.** There is no encoding for `CALL`, `PROG`, `PLURALITY`, `tick`, `EMIT` or
any branch. The compiler throws and names the key it refused. In exchange:

- the vertex and index ceiling is derived from the header at load, and a load
  that returns 0 *guarantees* every later build fits;
- nothing allocates on the frame path, so linear memory never grows
  (measured: 257 pages → 257 pages across a full run and 4,000 fuzzed programs);
- because memory never moves, a JS typed-array view over it **can never
  detach** — the standard WASM/JS graphics footgun is removed structurally
  rather than defended against;
- and the arena's interleave *is* the GPU's vertex layout, so decode output
  goes to `bufferData` with no repack.

**Bounded FSM and zero-copy are the same constraint from opposite ends.** Every
rival buys expressiveness and pays for it with an allocator. This buys the
allocator's absence and pays for it with expressiveness. That is a genuine trade,
not a free lunch, and which side is right depends entirely on the workload.

Where it would matter: fixed-budget targets where a frame-time or memory spike
is a failure rather than a slowdown — embedded and automotive displays,
watch faces, XR compositors, ad units under a hard byte budget, and any host
that will not tolerate a GC pause. That is a real market and it is not one Rive
or Lottie is optimised for. **It is also not a market `.geo` has entered, talked
to, or validated against.**

---

## 5 · Threats

**1 · `KHR_interactivity` is the serious one.** If Khronos ratifies behaviour
graphs into glTF, the "the file carries its own behaviour" position stops being
differentiated and starts being table stakes — attached to the format every tool
already exports. `.geo`'s answer has to shift entirely onto the bound, which is
a narrower and more technical claim to sell. Monitor the ratification.

**2 · Rive can add a bounded mode more easily than `.geo` can add an editor.**
The gap between these two products is one editor and five platform runtimes in
one direction, and one memory discipline in the other. The second is a smaller
lift. If bounded execution ever becomes a selling point, the incumbent with the
editor can go get it.

**3 · The predecessor is the real competitor.** GeoV v36 ships, has an editor, a
plan timeline, PLATE fills, and users. And **variant B — a typed arena inside
v36's existing JavaScript — measured 3.5× for roughly an afternoon of work, with
no new format and no rewrite.** Two-thirds of the total speedup, for a rounding
error of the cost. Any reader evaluating this should weigh that: the rebuild is
a bet on the format's future, not a rescue of a performance problem, and the
cheap fix was never refused.

**4 · WebGPU widens the gap in raw capability.** Three.js's WebGPU renderer is
mature enough for production. `.geo` is WebGL2.

---

## 6 · What this actually is, for a hiring reader

Not a product. A **six-day, ground-up systems build** with:

- a bounded ISA whose refusals are the design, not a backlog;
- a Rust/WASM kernel with **zero imports** and no allocator;
- **byte-level equivalence with a live production oracle**, measured — not
  "looks right," but 0 index mismatches and a worst delta of 8.2e-7 at fourteen
  points along the plan, with the residual attributed to the format's own f32
  storage;
- a **fuzz harness that found a real bug** — a 32-bit multiply wrap in the
  ceiling derivation on `wasm32`, which is precisely the class of bug that turns
  a bounded VM into an unbounded one — plus the regression test that now asserts
  totality;
- a **reachability gate**, because the predecessor shipped a control that was
  visible, unclipped, and covered by the next panel for months. The rebuild
  reproduced that failure on day one, in a brand-new HUD, three lines under a
  comment citing the original. It is now tested with `elementFromPoint` on every
  control at three window sizes — and the note in the log that a Playwright drag
  test *alone* would have shipped it;
- three measurement traps caught and documented, each of which had produced a
  confident number for work that had not happened;
- and a written statement of what is *not* proven, in the architecture doc, above
  the fold rather than in a footnote.

The strongest signal here is not the 10×. It is that **the 10× is reported next
to the fact that the build is now 14% of the CPU frame and the buffer upload is
84%** — the win named, the new bottleneck named in the same table, and the
cheaper alternative that was never refused named in both documents.

---

## 7 · What would change this brief

- **A second character.** One test character at fourteen times is a deep check
  of a narrow input. Correctness across a real content library is unproven.
- **An authoring path a person other than the author can use.** Right now the
  editor is GeoV and the compiler mostly says no.
- **A non-web runtime.** The bound argument is strongest on constrained targets,
  and there is no evidence on one.
- **The upload fixed.** Until the 84% is addressed, the end-to-end frame win is
  much smaller than the decode win, and this brief would be dishonest to imply
  otherwise.
- **`KHR_interactivity` ratifying.** Re-read §5.

---

### Sources

- [glTF Interactivity Extension Submitted for Ratification — Khronos](https://www.khronos.org/news/press/gltf-interactivity-extension-submitted-for-ratification)
- [glTF — Runtime 3D Asset Delivery — Khronos](https://www.khronos.org/gltf/)
- [.riv File Format — Rive](https://rive.app/docs/runtimes/advanced-topic/format)
- [spine-runtimes — Esoteric Software](https://github.com/EsotericSoftware/spine-runtimes)
- [Spine: Runtimes](http://esotericsoftware.com/spine-runtimes/)
- Internal: `bench/results/sprint1.json`, `validate.json`, `fuzz.json`,
  `bench/baseline/bench-002-phases.json`
