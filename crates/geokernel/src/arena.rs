// ═══════════════════════════════════════════════════════════════════════════
// THE ARENA — permanent architecture, not sprint-0 scaffolding.
//
// A depth-D quadtree has at most (4^(D+1)−1)/3 nodes, known BEFORE execution.
// A known ceiling means the arena size is computable before execution, which
// means no Vec, no realloc, no `memory.grow` — and therefore no detached
// typed-array view on the JS side.
//
//   BOUNDED FSM ⟺ ZERO-COPY.  Same constraint, opposite ends.
//
// The arena's layout IS the GPU's layout: pos3 uv2 nrm3 = 8 floats, the exact
// interleave gl.bufferData wants. Nothing is repacked on the way out.
//
//   THE DECODE OUTPUT IS THE DRAW INPUT.
// ═══════════════════════════════════════════════════════════════════════════

/// Vertex stride, in floats. pos3 · uv2 · nrm3.
pub const STRIDE: usize = 8;

/// The ceiling. Sized once, here, and never grown.
pub const MAX_VERTS: usize = 262_144;
pub const MAX_IDX: usize = 1_572_864;

pub static mut VBUF: [f32; MAX_VERTS * STRIDE] = [0.0; MAX_VERTS * STRIDE];
pub static mut IBUF: [u32; MAX_IDX] = [0; MAX_IDX];

/// Write cursors, in elements (floats / indices), not vertices.
pub static mut VN: usize = 0;
pub static mut IN_: usize = 0;

/// ⚠ Set if any write was refused because it would pass the ceiling.
/// A silent overflow is the one way a bounded arena can lie, so it is counted
/// and exported rather than trusted.
pub static mut OVERFLOW: u32 = 0;

#[inline(always)]
pub unsafe fn reset() {
    VN = 0;
    IN_ = 0;
}

/// Append one vertex in the final GPU layout. Refuses past the ceiling.
#[inline(always)]
pub unsafe fn push(p: [f32; 3], uv: [f32; 2], n: [f32; 3]) {
    let i = VN;
    if i + STRIDE > MAX_VERTS * STRIDE {
        OVERFLOW += 1;
        return;
    }
    VBUF[i] = p[0];
    VBUF[i + 1] = p[1];
    VBUF[i + 2] = p[2];
    VBUF[i + 3] = uv[0];
    VBUF[i + 4] = uv[1];
    VBUF[i + 5] = n[0];
    VBUF[i + 6] = n[1];
    VBUF[i + 7] = n[2];
    VN = i + STRIDE;
}

/// The quad-grid indexer every surface primitive shares.
/// `base` is a VERTEX index; the grid is (nu+1) × (nv+1) vertices.
#[inline(always)]
pub unsafe fn quads(base: usize, nu: usize, nv: usize) {
    let need = nu * nv * 6;
    if IN_ + need > MAX_IDX {
        OVERFLOW += 1;
        return;
    }
    let mut k = IN_;
    for iv in 0..nv {
        for iu in 0..nu {
            let a = (base + iv * (nu + 1) + iu) as u32;
            let b = a + 1;
            let c = a + (nu + 1) as u32;
            let d = c + 1;
            IBUF[k] = a;
            IBUF[k + 1] = c;
            IBUF[k + 2] = b;
            IBUF[k + 3] = b;
            IBUF[k + 4] = c;
            IBUF[k + 5] = d;
            k += 6;
        }
    }
    IN_ = k;
}

/// Vertices a (nu+1)×(nv+1) grid costs. The static bound every surface
/// instruction must be able to state BEFORE it runs.
///
/// ⚠⚠ TOTAL, ON PURPOSE — no input panics and none wraps.
///   The first version of this saturated the MULTIPLY and left `nu + 1` able to
///   overflow, which in a debug build panics and in a release build wraps
///   silently to zero — a ceiling of nothing, which then passes every check
///   below it. Reachable inputs are u8-capped today, so this is defence rather
///   than a live bug; it is written this way because the day the header widens
///   a field, nobody will remember to come back here.
#[inline(always)]
pub const fn grid_verts(nu: usize, nv: usize) -> usize {
    nu.saturating_add(1).saturating_mul(nv.saturating_add(1))
}

#[inline(always)]
pub const fn grid_idx(nu: usize, nv: usize) -> usize {
    nu.saturating_mul(nv).saturating_mul(6)
}
