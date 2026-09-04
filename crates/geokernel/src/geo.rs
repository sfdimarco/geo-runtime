// ═══════════════════════════════════════════════════════════════════════════
// geo — the .geo v0 VM.
//
// The binary IS the program. The bytes are read directly, every frame: there is
// no decoded instruction cache and no per-load struct materialisation, because
// "the binary is the runtime" is a weaker claim if the binary is really a
// serialisation format for something else.
//
// Control flow is: walk the parts once, in order. No jumps, no calls, no
// backward branches, and time never feeds back into control flow — `t` picks
// one interpolated pose and is then done. That is what makes the header's
// ceiling a ceiling.
//
// See docs/GEO-V0-SPEC.md.
// ═══════════════════════════════════════════════════════════════════════════
use crate::arena::{self, grid_idx, grid_verts};
use crate::mesh;

pub const MAX_BIN: usize = 1 << 20; // 1 MiB of program
pub static mut BIN: [u8; MAX_BIN] = [0; MAX_BIN];
pub static mut BIN_LEN: usize = 0;
pub static mut LOADED: bool = false;

pub const MAGIC: u32 = 0x304F_4547; // little-endian read of b"GEO0"

// ── group table: one span per emitted part, so the draw path has colour ────
pub const MAX_GROUPS: usize = 1024;
/// start, count, col_a, col_b — 4 u32 per group.
pub static mut GROUPS: [u32; MAX_GROUPS * 4] = [0; MAX_GROUPS * 4];
pub static mut GROUP_N: usize = 0;

const HEADER: usize = 64;
const PART: usize = 96;
const CHAN: usize = 48;
const BEAT: usize = 24;

// ── raw reads. Unaligned little-endian, which is free on wasm. ─────────────
#[inline(always)]
unsafe fn u8_at(o: usize) -> u8 { BIN[o] }
#[inline(always)]
unsafe fn u16_at(o: usize) -> u16 { u16::from_le_bytes([BIN[o], BIN[o + 1]]) }
#[inline(always)]
unsafe fn u32_at(o: usize) -> u32 {
    u32::from_le_bytes([BIN[o], BIN[o + 1], BIN[o + 2], BIN[o + 3]])
}
#[inline(always)]
unsafe fn f32_at(o: usize) -> f32 {
    f32::from_le_bytes([BIN[o], BIN[o + 1], BIN[o + 2], BIN[o + 3]])
}

// ── header accessors ───────────────────────────────────────────────────────
macro_rules! hdr_u16 { ($n:ident, $o:expr) => { #[inline(always)] unsafe fn $n() -> usize { u16_at($o) as usize } } }
macro_rules! hdr_u8  { ($n:ident, $o:expr) => { #[inline(always)] unsafe fn $n() -> usize { u8_at($o) as usize } } }
hdr_u16!(n_parts, 8);
hdr_u16!(n_poses, 10);
hdr_u16!(n_beats, 12);
hdr_u16!(n_solids, 14);
hdr_u16!(n_limbs, 16);
hdr_u16!(n_hands, 18);
hdr_u16!(n_leaves, 20);
hdr_u8!(loft_u, 22);
hdr_u8!(loft_v, 23);
hdr_u8!(sweep_nu, 24);
hdr_u8!(noodle_nv, 25);
hdr_u8!(mitt_u, 26);
hdr_u8!(mitt_v, 27);
hdr_u8!(leaf_u, 28);
hdr_u8!(leaf_v, 29);
#[inline(always)] unsafe fn flags() -> u16 { u16_at(6) }
#[inline(always)] unsafe fn doc_dw() -> f32 { f32_at(32) }
#[inline(always)] unsafe fn plan_end() -> f32 { f32_at(36) }
#[inline(always)] unsafe fn parts_off() -> usize { u32_at(48) as usize }
#[inline(always)] unsafe fn poses_off() -> usize { u32_at(52) as usize }
#[inline(always)] unsafe fn plan_off() -> usize { u32_at(56) as usize }

/// The ceiling, from the header alone — before a byte of the body is read.
// ⚠ SATURATING, NOT WRAPPING. usize is 32-bit on wasm32, and a header claiming
//   65535 solids at 255×255 wraps a plain multiply onto a SMALL number that then
//   passes the arena check — a bounded VM talked out of its bound by arithmetic.
//   Saturation makes an impossible header fail the check instead of sneaking
//   under it. The fuzz pass exists because this class of hole is invisible.
pub unsafe fn max_verts_from_header() -> usize {
    n_solids().saturating_mul(grid_verts(loft_u(), loft_v()))
        .saturating_add(n_limbs().saturating_mul(grid_verts(sweep_nu(), noodle_nv())))
        .saturating_add(n_hands().saturating_mul(grid_verts(mitt_u(), mitt_v())))
        .saturating_add(n_leaves().saturating_mul(grid_verts(leaf_u(), leaf_v())))
}
pub unsafe fn max_idx_from_header() -> usize {
    n_solids().saturating_mul(grid_idx(loft_u(), loft_v()))
        .saturating_add(n_limbs().saturating_mul(grid_idx(sweep_nu(), noodle_nv())))
        .saturating_add(n_hands().saturating_mul(grid_idx(mitt_u(), mitt_v())))
        .saturating_add(n_leaves().saturating_mul(grid_idx(leaf_u(), leaf_v())))
}

// ── load: validate everything the VM will later trust ──────────────────────
pub unsafe fn load(len: usize) -> i32 {
    LOADED = false;
    BIN_LEN = len;
    if len < HEADER { return -1; }
    if u32_at(0) != MAGIC { return -2; }
    if u16_at(4) != 0 { return -3; }

    let np = n_parts();
    let nq = n_poses();
    let nb = n_beats();
    let po = parts_off();
    let so = poses_off();
    let lo = plan_off();

    // every section must lie inside the binary — checked with saturating maths
    // so a hostile length cannot wrap into a false pass
    if po > len || np.saturating_mul(PART).saturating_add(po) > len { return -4; }
    if so > len || nq.saturating_mul(np).saturating_mul(CHAN).saturating_add(so) > len { return -4; }
    if lo > len || nb.saturating_mul(BEAT).saturating_add(lo) > len { return -4; }
    if np > 255 || np == 0 || nq > 4096 || nb > 4096 { return -4; }

    // the declared ceiling must fit the arena, and must match what the header's
    // own counts imply — a header that lies about its ceiling is refused
    let mv = u32_at(40) as usize;
    let mi = u32_at(44) as usize;
    if mv != max_verts_from_header() || mi != max_idx_from_header() { return -5; }
    if mv > arena::MAX_VERTS || mi > arena::MAX_IDX { return -5; }
    if np > MAX_GROUPS { return -5; }
    // the sweep's curve scratch is itself a static bound
    if noodle_nv() + 1 > mesh::MAX_PTS { return -5; }

    // referential integrity: hosts and pose indices
    let mut solids = 0usize;
    let mut limbs = 0usize;
    let mut hands = 0usize;
    let mut leaves = 0usize;
    for i in 0..np {
        let b = po + i * PART;
        let kind = u8_at(b);
        let fl = u8_at(b + 1);
        let host = u8_at(b + 2) as usize;
        if host != 0xFF && host >= np { return -6; }
        if u8_at(b + 3) > 6 { return -6; }
        if fl & 1 != 0 { continue; }          // `off` parts emit nothing
        match kind {
            0 => solids += 1,
            1 => { limbs += 1; if fl & 2 != 0 { hands += 1; } }
            2 => leaves += 1,
            _ => return -6,
        }
    }
    if solids != n_solids() || limbs != n_limbs()
        || hands != n_hands() || leaves != n_leaves() { return -7; }

    for k in 0..nb {
        if u16_at(lo + k * BEAT) as usize >= nq.max(1) { return -6; }
    }

    LOADED = true;
    0
}

// ── the ease, ported exactly from gcCurveAt ───────────────────────────────
#[inline]
fn curve_at(ho: [f32; 2], hi: [f32; 2], w: f64) -> f64 {
    let p1x = ho[0].clamp(0.0, 1.0) as f64;
    let p1y = ho[1] as f64;
    let p2x = (1.0 + hi[0]).clamp(0.0, 1.0) as f64;
    let p2y = (1.0 + hi[1]) as f64;
    let wd = w;
    let (mut lo, mut up) = (0.0f64, 1.0f64);
    let mut t = 0.5f64;
    for _ in 0..26 {
        t = (lo + up) * 0.5;
        let u = 1.0 - t;
        let x = 3.0 * u * u * t * p1x + 3.0 * u * t * t * p2x + t * t * t;
        if x < wd { lo = t; } else { up = t; }
    }
    let u = 1.0 - t;
    3.0 * u * u * t * p1y + 3.0 * u * t * t * p2y + t * t * t
}

/// One resolved pose channel for one part — the merge of the part's authored
/// value and the interpolated pose delta.
/// ⚠ f64 THROUGHOUT. The binary stores f32 — that is a deliberate format
///   decision and it costs a measured ~5 ULP against an f64-authored reference.
///   Doing the ARITHMETIC in f32 as well would add error the format never asked
///   for, so every value is widened the moment it is read.
#[derive(Clone, Copy)]
struct Chan {
    from: [f64; 3],
    mid: [f64; 3],
    to: [f64; 3],
    w: f64,
    taper: f64,
    off: bool,
}

/// The pose at `u`, for part `i`, merged onto the part's own values.
/// ⚠ A cleared mask bit means the pose says NOTHING about that channel and the
///   authored value stands — that is `_gcPosed`'s merge, made static.
#[inline]
unsafe fn resolve(i: usize, pa: usize, pb: usize, w: f64) -> Chan {
    let b = parts_off() + i * PART;
    let np = n_parts();
    let so = poses_off();

    let mut c = Chan {
        from: [f32_at(b + 48) as f64, f32_at(b + 52) as f64, f32_at(b + 56) as f64],
        mid: [f32_at(b + 60) as f64, f32_at(b + 64) as f64, f32_at(b + 68) as f64],
        to: [f32_at(b + 72) as f64, f32_at(b + 76) as f64, f32_at(b + 80) as f64],
        w: f32_at(b + 24) as f64,
        taper: f32_at(b + 36) as f64,
        off: u8_at(b + 1) & 1 != 0,
    };
    if n_poses() == 0 { return c; }

    let ca = so + (pa * np + i) * CHAN;
    let cb = so + (pb * np + i) * CHAN;
    let ma = u8_at(ca);
    let mb = u8_at(cb);

    // per channel: lerp when both poses set it, take the one that does when
    // only one does, keep the authored value when neither does
    macro_rules! vec3 {
        ($bit:expr, $off:expr, $dst:ident) => {
            let sa = ma & $bit != 0;
            let sb = mb & $bit != 0;
            if sa || sb {
                for j in 0..3 {
                    let va = if sa { f32_at(ca + $off + j * 4) as f64 } else { c.$dst[j] };
                    let vb = if sb { f32_at(cb + $off + j * 4) as f64 } else { c.$dst[j] };
                    c.$dst[j] = va + (vb - va) * w;
                }
            }
        };
    }
    vec3!(1, 4, from);
    vec3!(2, 16, mid);
    vec3!(4, 28, to);

    if ma & 8 != 0 || mb & 8 != 0 {
        let va = if ma & 8 != 0 { f32_at(ca + 40) as f64 } else { c.w };
        let vb = if mb & 8 != 0 { f32_at(cb + 40) as f64 } else { c.w };
        c.w = va + (vb - va) * w;
    }
    if ma & 16 != 0 || mb & 16 != 0 {
        let va = if ma & 16 != 0 { f32_at(ca + 44) as f64 } else { c.taper };
        let vb = if mb & 16 != 0 { f32_at(cb + 44) as f64 } else { c.taper };
        c.taper = va + (vb - va) * w;
    }
    // `off` is not a number: it flips at the halfway point, like gcPoseLerp's
    // non-numeric branch
    if ma & 32 != 0 || mb & 32 != 0 {
        c.off = if w < 0.5 { ma & 32 != 0 } else { mb & 32 != 0 };
    }
    c
}

/// Which two beats bracket `t`, and how far between them — `gcPlanPose`, exactly.
unsafe fn segment(t: f32) -> (usize, usize, f64) {
    let nb = n_beats();
    let nq = n_poses();
    if nb == 0 || nq == 0 { return (0, 0, 0.0); }
    let lo = plan_off();
    let beat_pose = |k: usize| u16_at(lo + k * BEAT) as usize;
    let beat_t = |k: usize| f32_at(lo + k * BEAT + 4);

    let end = plan_end() as f64;
    let mut u = t as f64;
    if flags() & 1 != 0 && end > 0.0 {
        u = ((u % end) + end) % end;
    }
    if u <= beat_t(0) as f64 { return (beat_pose(0), beat_pose(0), 0.0); }

    let mut i = 0usize;
    while i < nb - 1 && (beat_t(i + 1) as f64) <= u { i += 1; }

    let handles = |k: usize| -> ([f32; 2], [f32; 2]) {
        if u16_at(lo + k * BEAT + 2) & 1 != 0 {
            ([f32_at(lo + k * BEAT + 8), f32_at(lo + k * BEAT + 12)],
             [f32_at(lo + k * BEAT + 16), f32_at(lo + k * BEAT + 20)])
        } else {
            ([1.0 / 3.0, 0.0], [-1.0 / 3.0, 0.0])
        }
    };

    if i >= nb - 1 {
        if flags() & 1 == 0 { return (beat_pose(i), beat_pose(i), 0.0); }
        let w = (u - beat_t(i) as f64) / (end - beat_t(i) as f64).max(1e-3);
        let (ho, _) = handles(i);
        let (_, hi) = handles(0);
        return (beat_pose(i), beat_pose(0), curve_at(ho, hi, w));
    }
    let w = (u - beat_t(i) as f64) / (beat_t(i + 1) as f64 - beat_t(i) as f64).max(1e-3);
    let (ho, _) = handles(i);
    let (_, hi) = handles(i + 1);
    (beat_pose(i), beat_pose(i + 1), curve_at(ho, hi, w))
}

// ── body space → mesh space, ported from gcPt / gcRoot ────────────────────
#[inline(always)]
fn pt(e: [f64; 3], dw: f64) -> [f64; 3] {
    let (r, az, y) = (e[0], e[1], e[2]);
    [az.sin() * r, 1.0 - y, az.cos() * r * dw]
}

#[inline(always)]
unsafe fn group_push(start: usize, count: usize, a: u32, b: u32) {
    if GROUP_N >= MAX_GROUPS { return; }
    let g = GROUP_N * 4;
    GROUPS[g] = start as u32;
    GROUPS[g + 1] = count as u32;
    GROUPS[g + 2] = a;
    GROUPS[g + 3] = b;
    GROUP_N += 1;
}

/// Execute the program at time `t`. Returns the vertex count written.
pub unsafe fn build(t: f32) -> u32 {
    if !LOADED { return 0; }
    arena::reset();
    GROUP_N = 0;

    let np = n_parts();
    let po = parts_off();
    let ddw = doc_dw() as f64;
    let (pa, pb, w) = segment(t);

    // ⚠ SOLIDS FIRST, and not for convenience — a limb roots on its host's
    //   SURFACE, so the host's profile has to exist before the limb asks.
    //   Host geometry is recomputed rather than cached: 9 parts, and a cache is
    //   a second source of truth.
    for i in 0..np {
        let b = po + i * PART;
        if u8_at(b) != 0 { continue; }
        let c = resolve(i, pa, pb, w);
        if c.off { continue; }
        let i0 = arena::IN_;
        mesh::loft(
            f32_at(b + 12) as f64,       // x
            f32_at(b + 16) as f64,       // y0
            f32_at(b + 20) as f64,       // y1
            c.w,                         // w  (radius)
            f32_at(b + 32) as f64,       // dw
            u8_at(b + 3) as u32,         // prof id
            f32_at(b + 28) as f64,       // prof param
            loft_u(), loft_v(),
        );
        group_push(i0, arena::IN_ - i0, u32_at(b + 4), u32_at(b + 8));
    }

    for i in 0..np {
        let b = po + i * PART;
        let kind = u8_at(b);
        if kind == 0 { continue; }
        let c = resolve(i, pa, pb, w);
        if c.off { continue; }
        let dw = f32_at(b + 32) as f64;

        if kind == 1 {
            // a limb roots on its host's surface at its own height
            let host = u8_at(b + 2) as usize;
            let seat = f32_at(b + 40) as f64;
            let p0 = if host == 0xFF { pt(c.from, dw) }
                     else { root_on(host, c.from, seat, pa, pb, w) };
            let p2 = pt(c.to, dw);
            let pm = pt(c.mid, dw);
            let ctrl = [
                2.0 * pm[0] - (p0[0] + p2[0]) * 0.5,
                2.0 * pm[1] - (p0[1] + p2[1]) * 0.5,
                2.0 * pm[2] - (p0[2] + p2[2]) * 0.5,
            ];
            let i0 = arena::IN_;
            mesh::noodle(p0, ctrl, p2, c.w, c.taper, dw,
                         noodle_nv(), sweep_nu());
            group_push(i0, arena::IN_ - i0, u32_at(b + 4), u32_at(b + 8));

            if u8_at(b + 1) & 2 != 0 {
                let r = c.w * 2.2 * f32_at(b + 44) as f64;
                let i1 = arena::IN_;
                mesh::mitt(p2, [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]], r,
                           mitt_u(), mitt_v());
                // ⭐ a hand is ONE colour — the drawn mitts are solid, not split
                group_push(i1, arena::IN_ - i1, u32_at(b + 4), u32_at(b + 4));
            }
        } else if kind == 2 {
            let host = u8_at(b + 2) as usize;
            let i0 = arena::IN_;
            mesh::leaf(
                host_profile(host, pa, pb, w),
                f32_at(b + 92) as f64,   // az
                f32_at(b + 16) as f64,   // y
                c.w,
                f32_at(b + 88) as f64,   // h
                f32_at(b + 84) as f64,   // bow
                ddw, leaf_u(), leaf_v(),
            );
            group_push(i0, arena::IN_ - i0, u32_at(b + 4), u32_at(b + 8));
        }
    }

    (arena::VN / arena::STRIDE) as u32
}

/// The host solid's shape, as the numbers a limb or leaf needs from it.
#[inline]
unsafe fn host_profile(host: usize, pa: usize, pb: usize, w: f64) -> mesh::Host {
    if host == 0xFF || host >= n_parts() {
        // prof 255 is the "no host" sentinel the primitives test for
        return mesh::Host { x: 0.0, y0: 0.3, y1: 0.9, w: 0.16, dw: 1.0, prof: 255, k: 0.0 };
    }
    let b = parts_off() + host * PART;
    let c = resolve(host, pa, pb, w);
    mesh::Host {
        x: f32_at(b + 12) as f64,
        y0: f32_at(b + 16) as f64,
        y1: f32_at(b + 20) as f64,
        w: c.w,
        dw: f32_at(b + 32) as f64,
        prof: u8_at(b + 3) as u32,
        k: f32_at(b + 28) as f64,
    }
}

/// The root of a limb, ON THE SURFACE of the solid it hangs off — not at the
/// raw `from` point and not at the host's widest point. Rooting it anywhere
/// else is what buries an arm inside a body.
/// ⚠ `seat` belongs to the LIMB, so it is a parameter. A global the caller has
///   to remember to set is the same fail-open shape as a pose that silently
///   does not apply.
#[inline]
unsafe fn root_on(host: usize, from: [f64; 3], seat: f64,
                  pa: usize, pb: usize, w: f64) -> [f64; 3] {
    let h = host_profile(host, pa, pb, w);
    let e_az = from[1];
    let e_y = from[2];
    let t = ((e_y - h.y0) / (h.y1 - h.y0).max(1e-6)).clamp(0.0, 1.0);
    let rad = mesh::prof(h.prof, h.k, t) * h.w * seat;
    [h.x + e_az.sin() * rad, 1.0 - e_y, e_az.cos() * rad * h.dw]
}
