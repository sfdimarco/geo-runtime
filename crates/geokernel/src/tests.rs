// ═══════════════════════════════════════════════════════════════════════════
// Unit tests — the logic that can be wrong SILENTLY.
//
// The browser harnesses (validate · fuzz · sprint1) are the real proof, but they
// take minutes and need Chromium. These run in milliseconds and gate a commit.
//
// ⚠ The kernel is a pile of `static mut` by design, so every test that touches
//   the arena or the program serialises on one lock. Without it `cargo test`'s
//   thread pool races them and the failures are nondeterministic — which is the
//   worst kind of test.
// ═══════════════════════════════════════════════════════════════════════════
use crate::{arena, geo, mesh};
use std::sync::{Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());
fn guard() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

const HEADER: usize = 64;
const PART: usize = 96;

/// A minimal, valid one-solid program. `res` sets both loft resolutions.
fn minimal(res: u8) -> Vec<u8> {
    let nu = res as usize;
    let mv = (nu + 1) * (nu + 1);
    let mi = nu * nu * 6;
    let mut b = vec![0u8; HEADER + PART];
    b[0..4].copy_from_slice(&0x304F_4547u32.to_le_bytes()); // "GEO0"
    b[4..6].copy_from_slice(&0u16.to_le_bytes());           // version
    b[6..8].copy_from_slice(&1u16.to_le_bytes());           // loop
    b[8..10].copy_from_slice(&1u16.to_le_bytes());          // n_parts
    b[10..12].copy_from_slice(&0u16.to_le_bytes());         // n_poses
    b[12..14].copy_from_slice(&0u16.to_le_bytes());         // n_beats
    b[14..16].copy_from_slice(&1u16.to_le_bytes());         // n_solids
    b[22] = res; b[23] = res;                               // loft_u, loft_v
    b[24] = 4; b[25] = 4; b[26] = 4; b[27] = 4; b[28] = 4; b[29] = 4;
    b[32..36].copy_from_slice(&1.0f32.to_le_bytes());       // dw
    b[36..40].copy_from_slice(&1.0f32.to_le_bytes());       // plan_end
    b[40..44].copy_from_slice(&(mv as u32).to_le_bytes());  // max_verts
    b[44..48].copy_from_slice(&(mi as u32).to_le_bytes());  // max_idx
    b[48..52].copy_from_slice(&(HEADER as u32).to_le_bytes());
    b[52..56].copy_from_slice(&((HEADER + PART) as u32).to_le_bytes());
    b[56..60].copy_from_slice(&((HEADER + PART) as u32).to_le_bytes());
    b[60..64].copy_from_slice(&((HEADER + PART) as u32).to_le_bytes());

    let p = HEADER;
    b[p] = 0;        // solid
    b[p + 1] = 0;    // flags
    b[p + 2] = 0xFF; // no host
    b[p + 3] = 0;    // sphere
    for (i, v) in [0.0f32, 0.1, 0.9, 0.25, 0.0, 1.0, 0.0, 1.0, 1.0].iter().enumerate() {
        b[p + 12 + i * 4..p + 16 + i * 4].copy_from_slice(&v.to_le_bytes());
    }
    b
}

fn load(bytes: &[u8]) -> i32 {
    unsafe {
        geo::BIN[..bytes.len()].copy_from_slice(bytes);
        geo::load(bytes.len())
    }
}

// ── the profile generators ────────────────────────────────────────────────
#[test]
fn profiles_hit_their_endpoints() {
    let near = |a: f64, b: f64| assert!((a - b).abs() < 1e-12, "{a} != {b}");
    near(mesh::prof(0, 0.0, 0.0), 0.0);            // sphere pinches to a pole
    near(mesh::prof(0, 0.0, 1.0), 0.0);
    near(mesh::prof(0, 0.0, 0.5), 1.0);            // and is widest at the middle
    near(mesh::prof(2, 0.33, 0.0), 0.33);          // cone starts at its top
    near(mesh::prof(2, 0.33, 1.0), 1.0);
    near(mesh::prof(1, 0.4, 0.5), 0.6);            // pinch takes k out of the waist
    near(mesh::prof(1, 0.4, 0.0), 1.0);
    near(mesh::prof(6, 0.0, 0.5), 1.0);            // tube is a tube
    near(mesh::prof(3, 0.35, 0.5), 1.0);           // slab is flat through the middle
    near(mesh::prof(3, 0.35, 0.0), 0.0);           // and round at the ends
}

#[test]
fn profiles_clamp_outside_the_unit_interval() {
    // ⚠ a leaf reads its host's profile ABOVE and BELOW the host's own span
    assert_eq!(mesh::prof(0, 0.0, -3.0), mesh::prof(0, 0.0, 0.0));
    assert_eq!(mesh::prof(2, 0.5, 9.0), mesh::prof(2, 0.5, 1.0));
    assert!(mesh::prof(5, 0.0, -1.0).is_finite());
    assert!(mesh::prof(4, 0.0, 2.0).is_finite());
}

// ── the bounds arithmetic that the fuzz caught ────────────────────────────
#[test]
fn grid_bounds_saturate_instead_of_wrapping() {
    // ⚠⚠ THE REGRESSION TEST FOR THE HOLE THE FUZZ FOUND.
    //   usize is 32-bit on wasm32, so a plain multiply here lands on a SMALL
    //   number that then passes the arena check — a bounded VM talked out of
    //   its bound by arithmetic.
    assert_eq!(arena::grid_verts(4, 4), 25);
    assert_eq!(arena::grid_idx(4, 4), 96);
    // the widest a header field can go today
    assert_eq!(arena::grid_verts(255, 255), 65_536);
    // and TOTALITY: no input panics, none wraps. `nu + 1` is the one that bit.
    assert_eq!(arena::grid_verts(usize::MAX, usize::MAX), usize::MAX);
    assert_eq!(arena::grid_verts(usize::MAX, 0), usize::MAX);
    assert_eq!(arena::grid_verts(0, usize::MAX), usize::MAX);
    assert_eq!(arena::grid_idx(usize::MAX, usize::MAX), usize::MAX);
}

#[test]
fn a_header_that_cannot_fit_the_arena_is_refused() {
    let _g = guard();
    // the largest thing a header can even ask for: every count and every
    // resolution at its field maximum
    let mut b = minimal(4);
    b[14..16].copy_from_slice(&65535u16.to_le_bytes());   // n_solids
    b[16..18].copy_from_slice(&65535u16.to_le_bytes());   // n_limbs
    b[18..20].copy_from_slice(&65535u16.to_le_bytes());   // n_hands
    b[20..22].copy_from_slice(&65535u16.to_le_bytes());   // n_leaves
    for i in 22..30 { b[i] = 255; }
    let mv = unsafe {
        geo::BIN[..b.len()].copy_from_slice(&b);
        geo::max_verts_from_header()
    };
    assert!(mv > arena::MAX_VERTS,
            "the biggest header a file can express must not land under the arena ceiling ({mv})");
    assert_eq!(load(&b), -5, "an impossible ceiling must be refused");
}

// ── load: every rejection path, by code ───────────────────────────────────
#[test]
fn load_accepts_a_minimal_program() {
    let _g = guard();
    assert_eq!(load(&minimal(4)), 0);
    unsafe {
        assert!(geo::LOADED);
        assert_eq!(geo::max_verts_from_header(), 25);
        assert_eq!(geo::max_idx_from_header(), 96);
    }
}

#[test]
fn load_rejects_with_the_documented_codes() {
    let _g = guard();

    assert_eq!(load(&[0u8; 8]), -1, "too short for a header");

    let mut b = minimal(4);
    b[0] = 0;
    assert_eq!(load(&b), -2, "bad magic");

    let mut b = minimal(4);
    b[4..6].copy_from_slice(&7u16.to_le_bytes());
    assert_eq!(load(&b), -3, "unsupported version");

    let mut b = minimal(4);
    b[48..52].copy_from_slice(&9_000_000u32.to_le_bytes());
    assert_eq!(load(&b), -4, "a section outside the binary");

    let mut b = minimal(4);
    b[40..44].copy_from_slice(&(25u32 + 1).to_le_bytes());
    assert_eq!(load(&b), -5, "a header lying about its own ceiling");

    let mut b = minimal(4);
    b[HEADER + 2] = 9;              // host index past n_parts
    assert_eq!(load(&b), -6, "a host index out of range");

    let mut b = minimal(4);
    b[14..16].copy_from_slice(&2u16.to_le_bytes());   // says 2 solids, has 1
    assert_eq!(load(&b), -5, "the ceiling no longer matches the counts");

    let mut b = minimal(4);
    b[HEADER] = 1;                  // a limb, but the header still says solid
    assert_eq!(load(&b), -7, "kind counts disagreeing with the part table");
}

#[test]
fn a_program_with_no_poses_and_no_plan_still_builds() {
    let _g = guard();
    assert_eq!(load(&minimal(4)), 0);
    unsafe {
        arena::OVERFLOW = 0;
        let n = geo::build(0.0);
        assert_eq!(n, 25, "one 4×4 loft is exactly (4+1)²");
        assert_eq!(n as usize, geo::max_verts_from_header(), "the bound is tight");
        assert_eq!(arena::IN_, 96);
        assert_eq!(arena::OVERFLOW, 0);
        assert_eq!(geo::GROUP_N, 1);
    }
}

#[test]
fn build_is_deterministic_and_time_only_moves_the_pose() {
    let _g = guard();
    assert_eq!(load(&minimal(6)), 0);
    unsafe {
        let n0 = geo::build(0.0);
        let first: Vec<f32> = arena::VBUF[..n0 as usize * 8].to_vec();
        // no poses, so no time can change the geometry
        for t in [0.0f32, 0.37, 9.9, -4.2, f32::MAX, f32::MIN] {
            let n = geo::build(t);
            assert_eq!(n, n0, "vertex count moved at t={t}");
            assert_eq!(&arena::VBUF[..n as usize * 8], &first[..], "geometry moved at t={t}");
        }
    }
}

#[test]
fn a_hostile_time_cannot_break_the_bound() {
    let _g = guard();
    assert_eq!(load(&minimal(8)), 0);
    unsafe {
        arena::OVERFLOW = 0;
        let ceil = geo::max_verts_from_header() as u32;
        for t in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 1e30, -1e30] {
            let n = geo::build(t);
            assert!(n <= ceil, "t={t} wrote {n} past the ceiling {ceil}");
        }
        assert_eq!(arena::OVERFLOW, 0);
    }
}

#[test]
fn building_before_loading_emits_nothing() {
    let _g = guard();
    unsafe {
        geo::LOADED = false;
        arena::OVERFLOW = 0;
        assert_eq!(geo::build(1.0), 0, "an unloaded VM must not emit geometry");
        assert_eq!(arena::OVERFLOW, 0);
    }
}

// ── the arena's own alarm ─────────────────────────────────────────────────
#[test]
fn the_arena_refuses_and_counts_instead_of_writing_past_its_end() {
    let _g = guard();
    unsafe {
        arena::reset();
        arena::OVERFLOW = 0;
        arena::VN = arena::MAX_VERTS * arena::STRIDE - arena::STRIDE;
        arena::push([1.0, 2.0, 3.0], [0.0, 0.0], [0.0, 1.0, 0.0]);   // the last slot
        assert_eq!(arena::OVERFLOW, 0);
        arena::push([9.0, 9.0, 9.0], [0.0, 0.0], [0.0, 1.0, 0.0]);   // one too many
        assert_eq!(arena::OVERFLOW, 1, "an overrun must be COUNTED, never silent");
        arena::reset();
        arena::OVERFLOW = 0;
    }
}
