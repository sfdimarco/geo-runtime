// ═══════════════════════════════════════════════════════════════════════════
// mesh — the surface primitives, ported from GeoV and VALIDATED BYTE-FOR-BYTE.
//
// BENCH-002 compared these against the engine's own gcLoft/gcSweep/gcMitt with
// the whole index buffer element by element (0 mismatches) and the whole vertex
// buffer float by float (max |Δ| = 5.96e-8, one f32 ULP), at 1×, 2×, 4× and 8×
// the geometry. That validation is expensive to reproduce, so the code carrying
// it moved into this repo intact.
//
// Resolutions are now PARAMETERS, not constants: the .geo header declares them,
// and the same header's declaration is what makes the arena ceiling computable
// before execution. A resolution someone typed inside a primitive is a bound
// nobody can see.
// ═══════════════════════════════════════════════════════════════════════════
use crate::arena;
use core::f64::consts::PI;

/// Scratch for a sampled curve. Bounded, never allocated.
/// ⚠ The static bound on a sweep is `MAX_PTS`; the header's `noodle_nv` is
///   checked against it at load, so a program cannot ask for more.
pub const MAX_PTS: usize = 256;
static mut PTS: [[f64; 3]; MAX_PTS] = [[0.0; 3]; MAX_PTS];

/// What a limb or a leaf needs to know about the solid it hangs off.
#[derive(Clone, Copy)]
pub struct Host {
    pub x: f64,
    pub y0: f64,
    pub y1: f64,
    pub w: f64,
    pub dw: f64,
    pub prof: u32,
    pub k: f64,
}

// ── vector helpers ─────────────────────────────────────────────────────────
#[inline(always)]
fn h3(a: [f64; 3]) -> f64 { (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt() }
#[inline(always)]
fn nrm(a: [f64; 3]) -> [f64; 3] {
    let l = h3(a);
    let l = if l == 0.0 { 1.0 } else { l };
    [a[0] / l, a[1] / l, a[2] / l]
}
#[inline(always)]
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
#[inline(always)]
unsafe fn emit(p: [f64; 3], n: [f64; 3], u: f64, w: f64) {
    arena::push(
        [p[0] as f32, p[1] as f32, p[2] as f32],
        [u as f32, w as f32],
        [n[0] as f32, n[1] as f32, n[2] as f32],
    );
}

// ── the profile generators — five closed forms, evaluated, never stored ────
#[inline]
pub fn prof(id: u32, k: f64, v: f64) -> f64 {
    let u = if v < 0.0 { 0.0 } else if v > 1.0 { 1.0 } else { v };
    match id {
        0 => 2.0 * (u * (1.0 - u)).sqrt(),                    // sphere
        1 => 1.0 - k * (u * PI).sin(),                        // pinch(k)
        2 => k + (1.0 - k) * u,                               // cone(top = k)
        3 => {                                                // slab(r = k)
            let r = k;
            if u < r {
                let t = (r - u) / r;
                (1.0 - t * t).sqrt()
            } else if u > 1.0 - r {
                let t = (u - (1.0 - r)) / r;
                (1.0 - t * t).sqrt()
            } else { 1.0 }
        }
        4 => 0.58 + 0.46 * (u * 1.9).sin(),                   // pear
        5 => 0.52 + 0.62 * (u.powf(0.78) * PI).sin(),         // sack
        _ => 1.0,                                             // tube
    }
}

// ── LOFT — an ellipse per height, from a traced profile ───────────────────
#[allow(clippy::too_many_arguments)]
pub unsafe fn loft(cx: f64, y0: f64, y1: f64, r_: f64, dw: f64,
                   pid: u32, pk: f64, nu: usize, nv: usize) {
    let dy = y1 - y0;
    let base = arena::VN / arena::STRIDE;
    let e = 1.0 / (nv as f64 * 40.0);
    for iv in 0..=nv {
        let v = iv as f64 / nv as f64;
        let r = prof(pid, pk, v) * r_;
        let hi = if v + e > 1.0 { 1.0 } else { v + e };
        let lo = if v - e < 0.0 { 0.0 } else { v - e };
        let rp = (prof(pid, pk, hi) - prof(pid, pk, lo)) * r_ / (hi - lo);
        let yy = 1.0 - (y0 + dy * v);
        for iu in 0..=nu {
            let a = (iu as f64 / nu as f64) * PI * 2.0;
            let s = a.sin();
            let c = a.cos();
            let n = nrm([dw * dy * s, dw * rp, dy * c]);
            emit([cx + r * s, yy, r * c * dw], n, iu as f64 / nu as f64, v);
        }
    }
    arena::quads(base, nu, nv);
}

// ── SWEEP — the one primitive. Parallel-transported frame, so no twist. ───
unsafe fn sweep(npts: usize, r0: f64, r1: f64, dw: f64, nu: usize) {
    if npts < 2 { return; }
    let last = npts - 1;
    let tan_at = |i: usize| -> [f64; 3] {
        let (a, b) = if i == 0 { (PTS[1], PTS[0]) }
                     else if i == last { (PTS[last], PTS[last - 1]) }
                     else { (PTS[i + 1], PTS[i - 1]) };
        nrm([a[0] - b[0], a[1] - b[1], a[2] - b[2]])
    };
    let mut t = tan_at(0);
    let mut u = nrm(cross(
        if t[1].abs() > 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] }, t));
    let mut v = cross(t, u);
    let base = arena::VN / arena::STRIDE;
    for i in 0..=last {
        let tt = i as f64 / last as f64;
        let p = PTS[i];
        let tn = tan_at(i);
        let ax = cross(t, tn);
        let s = h3(ax);
        if s > 1e-6 {
            let k = nrm(ax);
            let th = (if s > 1.0 { 1.0 } else { s }).asin();
            let cs = th.cos();
            let sn = th.sin();
            let kd = k[0] * u[0] + k[1] * u[1] + k[2] * u[2];
            let kc = cross(k, u);
            u = nrm([
                u[0] * cs + kc[0] * sn + k[0] * kd * (1.0 - cs),
                u[1] * cs + kc[1] * sn + k[1] * kd * (1.0 - cs),
                u[2] * cs + kc[2] * sn + k[2] * kd * (1.0 - cs),
            ]);
            v = cross(tn, u);
        }
        t = tn;
        let r = r0 + (r1 - r0) * tt;
        for iu in 0..=nu {
            let a = (iu as f64 / nu as f64) * PI * 2.0;
            let ca = a.cos();
            let sa = a.sin();
            let n = nrm([u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa]);
            emit([p[0] + n[0] * r, p[1] + n[1] * r, p[2] + n[2] * r * dw], n,
                 iu as f64 / nu as f64, tt);
        }
    }
    arena::quads(base, nu, last);
}

// ── NOODLE — sample the quadratic, then sweep it. A limb is a short trail. ─
#[allow(clippy::too_many_arguments)]
pub unsafe fn noodle(p0: [f64; 3], c: [f64; 3], p2: [f64; 3],
                     w: f64, taper: f64, dw: f64, nv: usize, nu: usize) {
    let nv = if nv + 1 > MAX_PTS { MAX_PTS - 1 } else { nv };
    for iv in 0..=nv {
        let t = iv as f64 / nv as f64;
        let m = 1.0 - t;
        PTS[iv] = [
            m * m * p0[0] + 2.0 * m * t * c[0] + t * t * p2[0],
            m * m * p0[1] + 2.0 * m * t * c[1] + t * t * p2[1],
            m * m * p0[2] + 2.0 * m * t * c[2] + t * t * p2[2],
        ];
    }
    sweep(nv + 1, w, w * (1.0 - taper), dw, nu);
}

// ── MITT — the hand as a volume. Wide across, thin through. ──────────────
pub unsafe fn mitt(tip: [f64; 3], along: [f64; 3], r: f64, nu: usize, nv: usize) {
    let base = arena::VN / arena::STRIDE;
    let t = nrm(if along[0] != 0.0 || along[1] != 0.0 || along[2] != 0.0 {
        along
    } else { [0.0, -1.0, 0.0] });
    let u = nrm(cross(
        if t[1].abs() > 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 1.0, 0.0] }, t));
    let v = cross(t, u);
    const LONG: f64 = 1.30;
    const THIN: f64 = 0.52;
    let c = [tip[0] + t[0] * r * 0.45, tip[1] + t[1] * r * 0.45, tip[2] + t[2] * r * 0.45];
    for iv in 0..=nv {
        let ph = (iv as f64 / nv as f64) * PI;
        let sr = ph.sin();
        let cr = ph.cos();
        for iu in 0..=nu {
            let a = (iu as f64 / nu as f64) * PI * 2.0;
            let sx = sr * a.cos();
            let sy = cr;
            let sz = sr * a.sin();
            let p = [
                c[0] + u[0] * sx * r + t[0] * sy * r * LONG + v[0] * sz * r * THIN,
                c[1] + u[1] * sx * r + t[1] * sy * r * LONG + v[1] * sz * r * THIN,
                c[2] + u[2] * sx * r + t[2] * sy * r * LONG + v[2] * sz * r * THIN,
            ];
            let n = nrm([
                u[0] * sx + t[0] * sy / LONG + v[0] * sz / THIN,
                u[1] * sx + t[1] * sy / LONG + v[1] * sz / THIN,
                u[2] * sx + t[2] * sy / LONG + v[2] * sz / THIN,
            ]);
            emit(p, n, iu as f64 / nu as f64, iv as f64 / nv as f64);
        }
    }
    arena::quads(base, nu, nv);
}

// ── LEAF — a flat plate carrying its OWN orientation ─────────────────────
// A leaf is not a thin solid: it is a surface that hangs off the form and bows
// around it, and its normal is its own. ⚠ v0 has no `tilt` slot — the compiler
// refuses a leaf that authors one rather than dropping it.
#[allow(clippy::too_many_arguments)]
pub unsafe fn leaf(h: Host, az: f64, y: f64, w: f64, hh: f64, bow: f64,
                   doc_dw: f64, nu: usize, nv: usize) {
    let has_host = h.prof != 255;
    let t0 = ((y - h.y0) / (h.y1 - h.y0).max(1e-6)).clamp(0.0, 1.0);
    let rad = if has_host { prof(h.prof, h.k, t0) * h.w } else { w };
    let (cx, cz) = if has_host {
        (h.x + az.sin() * rad, az.cos() * rad * h.dw)
    } else { (0.0, 0.0) };
    let base = arena::VN / arena::STRIDE;
    // ⚠ the ARC WIDTH is held constant, so `w` is a real width in figure
    //   fractions rather than an angle that changes with the host's girth
    let spread = (w / rad.max(1e-6)).min(2.8);
    for iv in 0..=nv {
        let v = iv as f64 / nv as f64;
        let yy = y + hh * v;
        let mut rr = rad;
        if has_host {
            let t = ((yy - h.y0) / (h.y1 - h.y0).max(1e-6)).clamp(0.0, 1.0);
            rr = prof(h.prof, h.k, t) * h.w;
            if rr < rad * 0.25 { rr = rad * 0.25; }   // past the host's end, do not pinch to nothing
        }
        let r = rr * (1.0 + bow * v);
        for iu in 0..=nu {
            let u = iu as f64 / nu as f64;
            let s = (u - 0.5) * 2.0;
            let a = az + s * spread * 0.5;
            let yout = 1.0 - yy;
            let (px, pz) = if has_host {
                (h.x + a.sin() * r * 1.04, a.cos() * r * 1.04 * h.dw)
            } else { (cx + s * w, cz) };
            let n0 = if has_host {
                [a.sin(), 0.26, a.cos() * h.dw]
            } else { [0.0, 0.26, doc_dw * 0.0 + 1.0] };
            emit([px, yout, pz], nrm(n0), u, v);
        }
    }
    arena::quads(base, nu, nv);
}
