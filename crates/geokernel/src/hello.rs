// ═══════════════════════════════════════════════════════════════════════════
// HELLO — sprint 0's payload. NO GeoV CONTENT.
//
// A parametric wave surface. It exists to prove the pipe and nothing else:
// Rust writes floats into the arena → JS views linear memory → gl.bufferData
// → WebGL2 draws. If the normals are wrong the shading goes flat and you can
// SEE it, so this is a test you can look at rather than only measure.
//
// ⭐ RES is the constant Sprint 0's "done when" turns on:
//    change it, rebuild, and the chart moves with nobody touching the harness.
// ═══════════════════════════════════════════════════════════════════════════
use crate::arena::{self, grid_idx, grid_verts};
use core::f32::consts::PI;

/// ⭐ THE CONSTANT. Segments across one tile of the wave surface.
/// 48 → 24,010 verts at 6 tiles. Try 72 and watch the chart move: verts +123%.
pub const RES: usize = 48;

const TAU: f32 = 2.0 * PI;

/// Static bound, computable before a single vertex is written.
pub const fn max_verts(tiles: usize) -> usize {
    grid_verts(RES * tiles, RES)
}
pub const fn max_idx(tiles: usize) -> usize {
    grid_idx(RES * tiles, RES)
}

/// Build the wave surface. `tiles` stretches it in u — the harness's sweep axis.
///
/// z = A·sin(u·τ·waves)·cos(v·τ) with analytic normals, so the surface is
/// curved in both directions and a wrong normal is visible immediately.
pub unsafe fn build(tiles: usize) {
    arena::reset();
    let nu = RES * tiles.max(1);
    let nv = RES;
    let amp: f32 = 0.22;
    let waves: f32 = 1.5;

    let base = arena::VN / arena::STRIDE;
    for iv in 0..=nv {
        let v = iv as f32 / nv as f32;
        let cv = (v * TAU).cos();
        let sv = (v * TAU).sin();
        for iu in 0..=nu {
            let u = iu as f32 / nu as f32;
            let su = (u * TAU * waves).sin();
            let cu = (u * TAU * waves).cos();

            let x = u * 2.0 - 1.0;
            let y = v * 2.0 - 1.0;
            let z = amp * su * cv;

            // ∂z/∂x and ∂z/∂y, in the same units as x and y (both span 2.0)
            let dzdx = amp * cu * TAU * waves * cv * 0.5;
            let dzdy = -amp * su * sv * TAU * 0.5;
            let nx = -dzdx;
            let ny = -dzdy;
            let nz = 1.0;
            let l = (nx * nx + ny * ny + nz * nz).sqrt();

            arena::push([x, y, z], [u, v], [nx / l, ny / l, nz / l]);
        }
    }
    arena::quads(base, nu, nv);
}
