// ═══════════════════════════════════════════════════════════════════════════
// geokernel — the .geo runtime kernel.
//
// No wasm-bindgen. No wasm-pack. No imports at all: a cdylib with extern "C"
// exports over a static arena, which is the whole bridge.
//
// Sprint 0 proves the pipe with `hello`. Sprint 1 drives `mesh` from the .geo
// bounded ISA. Both are live entry points — nothing here is parked behind a
// flag.
// ═══════════════════════════════════════════════════════════════════════════
pub mod arena;
pub mod geo;
pub mod hello;
pub mod mesh;

#[cfg(test)]
mod tests;

use arena::{IBUF, IN_, OVERFLOW, VBUF, VN};

// ── the bridge ─────────────────────────────────────────────────────────────
// Pointers are byte offsets into linear memory. JS makes typed-array views
// over them. Nothing is copied in either direction.

#[no_mangle]
pub extern "C" fn mesh_ptr() -> *const f32 {
    core::ptr::addr_of!(VBUF) as *const f32
}
#[no_mangle]
pub extern "C" fn idx_ptr() -> *const u32 {
    core::ptr::addr_of!(IBUF) as *const u32
}
/// Floats written, not vertices.
#[no_mangle]
pub extern "C" fn mesh_len() -> u32 {
    unsafe { VN as u32 }
}
#[no_mangle]
pub extern "C" fn idx_len() -> u32 {
    unsafe { IN_ as u32 }
}
#[no_mangle]
pub extern "C" fn vert_stride() -> u32 {
    arena::STRIDE as u32
}
#[no_mangle]
pub extern "C" fn vert_count() -> u32 {
    unsafe { (VN / arena::STRIDE) as u32 }
}

// ── the bound, stated and checked ──────────────────────────────────────────

/// The arena's ceiling in vertices — known before any input is read.
#[no_mangle]
pub extern "C" fn max_verts() -> u32 {
    arena::MAX_VERTS as u32
}
#[no_mangle]
pub extern "C" fn max_idx() -> u32 {
    arena::MAX_IDX as u32
}
/// ⚠ Non-zero means a write was refused for passing the ceiling. A bounded
/// arena that overflows silently is worse than an unbounded one; this is the
/// alarm, and the harness fails the run on it.
#[no_mangle]
pub extern "C" fn overflow_count() -> u32 {
    unsafe { OVERFLOW }
}
#[no_mangle]
pub extern "C" fn clear_overflow() {
    unsafe { OVERFLOW = 0 };
}

/// Linear-memory size in 64 KiB pages. The harness asserts this NEVER changes
/// across a run — that assertion is what makes the zero-copy view safe.
#[no_mangle]
pub extern "C" fn mem_pages() -> u32 {
    #[cfg(target_arch = "wasm32")]
    { core::arch::wasm32::memory_size(0) as u32 }
    #[cfg(not(target_arch = "wasm32"))]
    { 0 }
}

/// ⚠ TEST ONLY — deliberately grows linear memory so the harness can PROVE a
/// stale view detaches. Never called by the runtime path. It exists so the
/// footgun is demonstrated rather than asserted away.
#[no_mangle]
pub extern "C" fn __test_grow(pages: u32) -> i32 {
    #[cfg(target_arch = "wasm32")]
    { core::arch::wasm32::memory_grow(0, pages as usize) as i32 }
    #[cfg(not(target_arch = "wasm32"))]
    { let _ = pages; -1 }
}

// ── entry points ───────────────────────────────────────────────────────────

/// SPRINT 0 — the pipe. Returns the vertex count written.
#[no_mangle]
pub extern "C" fn build_hello(tiles: u32) -> u32 {
    unsafe {
        hello::build(tiles as usize);
        (VN / arena::STRIDE) as u32
    }
}

/// The static bound for `build_hello`, computable before it runs.
#[no_mangle]
pub extern "C" fn bound_hello(tiles: u32) -> u32 {
    hello::max_verts(tiles.max(1) as usize) as u32
}

/// The compile-time resolution constant, exported so the harness can label a
/// run with the constant it was built from instead of being told.
#[no_mangle]
pub extern "C" fn hello_res() -> u32 {
    hello::RES as u32
}

// ── the .geo v0 VM ─────────────────────────────────────────────────────────
// ⚠ PRUNE, NEVER PARK: the flat op array BENCH-002 used to drive the mesh pass
//   is gone, not disabled. The .geo binary replaced it, so it was deleted.

/// Where the host writes the program. Write, then call `geo_load(len)`.
#[no_mangle]
pub extern "C" fn geo_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(geo::BIN) as *mut u8
}
#[no_mangle]
pub extern "C" fn geo_capacity() -> u32 { geo::MAX_BIN as u32 }

/// Validate and accept a program. 0 = ok; see docs/GEO-V0-SPEC.md for codes.
/// A load that succeeds guarantees every later `geo_build` fits the arena.
#[no_mangle]
pub extern "C" fn geo_load(len: u32) -> i32 {
    unsafe { geo::load(len as usize) }
}

/// Execute the program at time `t`. Returns vertices written.
#[no_mangle]
pub extern "C" fn geo_build(t: f32) -> u32 {
    unsafe { geo::build(t) }
}

/// The ceiling the header declares — computable before the body is read.
#[no_mangle]
pub extern "C" fn geo_max_verts() -> u32 {
    unsafe { if geo::LOADED { geo::max_verts_from_header() as u32 } else { 0 } }
}
#[no_mangle]
pub extern "C" fn geo_max_idx() -> u32 {
    unsafe { if geo::LOADED { geo::max_idx_from_header() as u32 } else { 0 } }
}
#[no_mangle]
pub extern "C" fn geo_plan_end() -> f32 {
    unsafe { if geo::LOADED { f32::from_le_bytes([geo::BIN[36], geo::BIN[37], geo::BIN[38], geo::BIN[39]]) } else { 0.0 } }
}

/// Per-part spans for the draw path: start, count, col_a, col_b — 4 u32 each.
#[no_mangle]
pub extern "C" fn groups_ptr() -> *const u32 {
    core::ptr::addr_of!(geo::GROUPS) as *const u32
}
#[no_mangle]
pub extern "C" fn groups_len() -> u32 { unsafe { geo::GROUP_N as u32 } }
