# `.geo` v0 — the bounded rig dialect

**Little-endian. Fixed-stride. No pointers, no loops, no jumps.**

The header states the arena ceiling *before a single byte of the body is read*.
That is the whole point: a program whose maximum cost is known before it runs is
a program you can hand a preallocated arena, and an arena that never grows is a
`Float32Array` view that can never detach.

> **Bounded FSM ⟺ zero-copy.** The same constraint from opposite ends.

## v0.1 — a hand may carry a profile

**Additive. The header did not change, the 96-byte part record did not change,
and every v0 program compiles to the same bytes it did before** — checked, not
claimed: the reference character is still 2,320 B, still a 5,787-vert ceiling,
and `bench/validate.mjs` still finds it IDENTICAL to GeoV's own `gcBuildForm`.

**The gap it closes.** A `solid` has a fixed `x`/`y` and no parent, and
`POSE_KEYS` is limb-only — *a pose that touches a solid is refused*. So a boot
modelled as a solid **could not be keyed in any pose**. The reference
character's `bootL` detached from `legL` by a measured **0.094** when the stomp
lifted the leg; the only foot that followed a limb was a `hand`, and every hand
was hardcoded to the mitt profile, which is an almond continuing the limb's
line — **not a slab boot**.

> **v0 could express a boot that LOOKED right, or a foot that MOVED. Never
> both.**

A profiled hand has **no position of its own**. It is emitted at the limb's
*resolved* tip every frame, so `bench/joint.mjs` measures the tip-to-foot
distance as a **constant the cast declares** — spread 1.6e-8 across the whole
plan, against 0.0087→0.1088 for the solid it replaces. That is the difference
between *attachment* and two parts *agreeing about a coordinate*.

It costs nothing: the hand emits the same `(mitt_u+1)(mitt_v+1)` grid, so the
ceiling arithmetic below is untouched — and the reference character's ceiling
*falls* 5,787 → 5,043 because two 27×27 lofts became two 21×17 hands.

⚠ **GeoV has no profiled hand.** A cast that uses one is outside the
byte-for-byte validate gate, which compares against GeoV's own engine. This is
the first thing `.geo` can express that the engine it was ported from cannot.

## What v0 deliberately cannot express

`.geo` v1 does not unify with the grammar engine by adoption — **it unifies by
restriction.** Everything that makes a program unbounded is absent, and there is
no encoding for it:

| absent | why |
|---|---|
| `CALL` / `PROG` / `PLURALITY` | subroutines and program-switching are unbounded recursion |
| `tick>=N`, `tick%P=R` | depth is capped; **time is not** |
| `EMIT` / `signal` / neighbour reads | propagation has no static step bound |
| any jump, any backward branch | control flow is "walk the parts once, in order" |
| a pose on a `solid` | `POSE_KEYS` is `from · mid · to · w · taper · off` — limb channels. **A solid cannot be animated at all.** Give the limb a profiled hand instead (v0.1, above), or move the solid's shape into the limb that should carry it. |

Time enters this dialect in exactly one place: `geo_build(t)` takes a wall-clock
`t`, evaluates **one** pose by interpolation, and returns. `t` never feeds back
into control flow. There is no state carried between frames.

⚠ **The compiler REFUSES what the ISA cannot represent** rather than dropping it
quietly. A pose key with no slot in the format is a compile error naming the key.

## Static bound

Computed from the header alone, by `geo_max_verts()`:

```
max_verts = n_solids × (loft_u+1)(loft_v+1)
          + n_limbs  × (sweep_nu+1)(noodle_nv+1)
          + n_hands  × (mitt_u+1)(mitt_v+1)
          + n_leaves × (leaf_u+1)(leaf_v+1)

max_idx   = n_solids × loft_u·loft_v·6  + …  (same shape)
```

`geo_load` refuses a binary whose declared ceiling exceeds the arena, so a load
that succeeds guarantees every later `geo_build` fits. **The fuzz pass exists to
prove the guarantee holds for inputs nobody wrote.**

## Layout

### Header — 64 bytes

| off | type | field |
|---|---|---|
| 0 | u32 | magic `0x30_4F_45_47` = `"GEO0"` |
| 4 | u16 | version = 0 |
| 6 | u16 | flags — bit0 `loop` |
| 8 | u16 | `n_parts` |
| 10 | u16 | `n_poses` |
| 12 | u16 | `n_beats` |
| 14 | u16 | `n_solids` |
| 16 | u16 | `n_limbs` |
| 18 | u16 | `n_hands` |
| 20 | u16 | `n_leaves` |
| 22–29 | u8 ×8 | `loft_u, loft_v, sweep_nu, noodle_nv, mitt_u, mitt_v, leaf_u, leaf_v` |
| 30 | u16 | reserved |
| 32 | f32 | `dw` — document depth ÷ width |
| 36 | f32 | `plan_end` — `gcPlanLength`, resolved at compile time |
| 40 | u32 | **`max_verts`** — the ceiling |
| 44 | u32 | **`max_idx`** |
| 48 | u32 | `parts_off` |
| 52 | u32 | `poses_off` |
| 56 | u32 | `plan_off` |
| 60 | u32 | `total_len` |

### Part — 96 bytes, `n_parts` of them

| off | type | field |
|---|---|---|
| 0 | u8 | `kind` 0 solid · 1 limb · 2 leaf |
| 1 | u8 | `flags` bit0 `off` · bit1 `hand` · **bit2 `hand carries a profile`** (v0.1) |
| 2 | u8 | `host` part index, `0xFF` = none |
| 3 | u8 | `prof_id` 0 sphere · 1 pinch · 2 cone · 3 slab · 4 pear · 5 sack · 6 tube. **solid: its own profile · limb with bit2: its HAND's profile · otherwise unread** |
| 4 | u32 | `col_a` `0x00RRGGBB` — palette resolved at compile time |
| 8 | u32 | `col_b` |
| 12 | f32 ×9 | `x, y0, y1, w, k, dw, taper, seat, hand_scale` |
| 48 | f32 ×3 | `from` = r, az, y |
| 60 | f32 ×3 | `mid` |
| 72 | f32 ×3 | `to` |
| 84 | f32 ×3 | `bow, h, az` — **leaf only** |
| 84 | f32, f32, u32 | `hand_back, hand_len, hand_col` — **limb with bit2 only**, the same three slots |

⚠⚠ **SLOTS 3, 28, 84, 88 AND 92 ARE PER-KIND, AND v0.1 ADDED NO FIELDS.** A
limb never read the solid's `prof_id`/`k` and never read the leaf's
`bow`/`h`/`az`, so a profiled hand borrows exactly those five slots: profile,
profile parameter, near-cap offset behind the tip (in multiples of `r`), length
along the limb axis (in multiples of `r`), and its own colour. `r` is the
mitt's own formula, `w · 2.2 · hand_scale`, so **the foot scales with the limb
and `w` is posable**. Defaults `hand_back = 0.85`, `hand_len = 2.6` place a
profiled hand in exactly the volume a mitt occupied.

`k` is the **resolved** profile parameter, not the authored `k`: a cone stores
`0.30 + 0.60·(1−k)`, a pinch or slab stores `k` itself. The generator is five
closed forms; the compiler picks which and hands over one number.

### Pose channel — 48 bytes, `n_poses × n_parts` of them

Row-major: pose *p*, part *i* lives at `poses_off + (p·n_parts + i)·48`.

| off | type | field |
|---|---|---|
| 0 | u8 | `mask` bit0 `from` · bit1 `mid` · bit2 `to` · bit3 `w` · bit4 `taper` · bit5 `off` |
| 4 | f32 ×3 | `from` |
| 16 | f32 ×3 | `mid` |
| 28 | f32 ×3 | `to` |
| 40 | f32 | `w` |
| 44 | f32 | `taper` |

A cleared `mask` means *this pose says nothing about this part* — the part's own
authored value stands. That is `_gcPosed`'s merge, made static.

### Plan beat — 24 bytes, `n_beats` of them

| off | type | field |
|---|---|---|
| 0 | u16 | `pose_idx` |
| 2 | u16 | `flags` bit0 = handles present |
| 4 | f32 | `t` |
| 8 | f32 ×4 | `ho_x, ho_y, hi_x, hi_y` — Bézier ease handles |

Absent handles default to `ho = (1/3, 0)`, `hi = (−1/3, 0)` — the engine's own
`gcSegEase` default, which is `cubic-bezier(1/3, 0, 2/3, 1)`.

## Execution

`geo_build(t)`:

1. **Wrap** `t` into `[0, plan_end)` when `loop` is set.
2. **Find the segment** — the last beat whose `t` is `≤ u`. Past the final beat,
   loop back to beat 0 over `plan_end − t_last`.
3. **Ease** `w` through the segment's Bézier handles (26-step bisection on x,
   then evaluate y — the engine's `gcCurveAt`, exactly).
4. **Lerp** the two poses channel by channel.
5. **Merge** each pose channel onto its part, masked.
6. **Emit**, in the engine's order: every solid first (a limb roots on its host's
   *surface*, so the host must exist), then each limb as a noodle plus its mitt,
   then each leaf.

⭐ **The bytes are read directly, every frame.** There is no decoded instruction
cache, no per-load struct materialisation. The claim "the binary is the runtime"
is weaker if the binary is really a serialisation format for something else, so
it is not one — and the cost of interpreting it is measured rather than assumed.

## Errors from `geo_load`

| code | meaning |
|---|---|
| 0 | ok |
| −1 | too short for a header |
| −2 | bad magic |
| −3 | unsupported version |
| −4 | a section offset or length falls outside the binary |
| −5 | the declared ceiling exceeds the arena |
| −6 | a part's `host`, its `prof_id`, or a beat's `pose_idx`, is out of range — **or flag bit2 (profiled hand) is set on something that is not a limb carrying a hand** |
| −7 | declared part-kind counts disagree with the part table |
