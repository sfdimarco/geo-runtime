// ═══════════════════════════════════════════════════════════════════════════
// bench/joint.mjs — DOES THE FOOT STAY ON THE LEG?
//
// The first render ever made of a .geo program showed bootL walking away from
// legL through the stomp. It was not a rendering bug: a `solid` has a fixed
// x/y and no parent, and POSE_KEYS is limb-only, so THE BOOT COULD NOT BE
// KEYED IN ANY POSE. Two parts were agreeing about a coordinate, and one of
// them moved.
//
// This measures the agreement, frame by frame, so the claim "it is attached"
// is a number and not a look:
//
//   joint  distance from the LIMB'S TIP RING to the FOOT'S TOP RING.
//          v0.1 places the foot AT the tip every frame, so this is constant.
//   overlap  the old bounding-box measure, kept so the two casts compare.
//            NEGATIVE MEANS A VISIBLE GAP.
//
// ⚠ Vertex bases are re-derived from the kernel's own emission order — solids
//   first, then limbs each followed by their hand — rather than read out of
//   GROUPS, whose first two ints are INDEX-buffer offsets, not vertex offsets.
//
//   node bench/joint.mjs                      # both casts, side by side
//   node bench/joint.mjs my.geocast legL      # one cast, one limb
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { loadCast, ROOT } from './kernel.mjs';

const R = { loft_u: 26, loft_v: 26, sweep_nu: 16, noodle_nv: 20,
            mitt_u: 20, mitt_v: 16, leaf_u: 20, leaf_v: 16 };
const GEOM = new Set(['solid', 'limb', 'leaf', 'patch']);

/** The kernel's emission order, and therefore every group's vertex base. */
function layout(doc) {
  const parts = (doc.parts || []).filter((p) => GEOM.has(p.kind) && !p.off);
  const out = [];
  let base = 0;
  const push = (id, what, u, v) => {
    out.push({ id, what, base, u, v, rows: v + 1, ring: u + 1 });
    base += (u + 1) * (v + 1);
  };
  for (const p of parts) if (p.kind === 'solid') push(p.id, 'solid', R.loft_u, R.loft_v);
  for (const p of parts) {
    if (p.kind === 'solid') continue;
    if (p.kind === 'limb') {
      push(p.id, 'limb', R.sweep_nu, R.noodle_nv);
      if (p.hand) push(p.id + ':hand', 'hand', R.mitt_u, R.mitt_v);
    } else push(p.id, 'leaf', R.leaf_u, R.leaf_v);
  }
  return out;
}

const ringCentre = (m, st, g, row) => {
  const c = [0, 0, 0];
  for (let i = 0; i < g.ring; i++) {
    const o = (g.base + row * g.ring + i) * st;
    c[0] += m[o]; c[1] += m[o + 1]; c[2] += m[o + 2];
  }
  return c.map((x) => x / g.ring);
};
const yRange = (m, st, g) => {
  let lo = 1e30, hi = -1e30;
  for (let i = 0; i < g.rows * g.ring; i++) {
    const y = m[(g.base + i) * st + 1];
    if (y < lo) lo = y; if (y > hi) hi = y;
  }
  return [lo, hi];
};

export async function joint(doc, limbId = 'legL', footId = null, n = 15) {
  const { K, header, info } = await loadCast(doc, { res: R });
  const L = layout(doc);
  const limb = L.find((g) => g.id === limbId && g.what === 'limb');
  const foot = L.find((g) => g.id === (footId ?? (limbId + ':hand')))
            ?? L.find((g) => g.id === footId);
  if (!limb || !foot) throw new Error(`no ${limbId} / ${footId ?? limbId + ':hand'} in this cast`);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * header.planEnd;
    const b = K.build(t), m = K.meshView(), st = b.stride;
    const a = ringCentre(m, st, limb, limb.rows - 1);   // the limb's TIP ring
    const c = ringCentre(m, st, foot, 0);               // the foot's TOP ring
    rows.push({
      t,
      joint: Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]),
      overlap: yRange(m, st, foot)[1] - yRange(m, st, limb)[0],
      verts: b.verts, overflow: b.overflow,
    });
  }
  return { info, header, foot: foot.what, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  const cases = a[0]
    ? [{ name: a[0], doc: JSON.parse(fs.readFileSync(a[0], 'utf8')), limb: a[1] ?? 'legL', foot: a[2] ?? null }]
    : [{ name: 'v0   boot is a SOLID', doc: read('bench/reference/v36-test-character.geocast'), limb: 'legL', foot: 'bootL' },
       { name: 'v0.1 boot is the HAND', doc: read('bench/reference/v36-test-character-boots.geocast'), limb: 'legL', foot: null }];

  let worst = Infinity, bad = 0;
  for (const c of cases) {
    const r = await joint(c.doc, c.limb, c.foot);
    console.log(`\n${c.name}   ${r.info.bytes} B · ceiling ${r.info.maxVerts} verts · foot is a ${r.foot}`);
    console.log('    t      joint     overlap');
    for (const row of r.rows) {
      const gap = row.overlap < 0;
      console.log(`  ${row.t.toFixed(2).padStart(5)}   ${row.joint.toFixed(4).padStart(7)}   ` +
                  `${row.overlap.toFixed(4).padStart(8)}  ${gap ? '<<< GAP' : ''}`);
      if (r.foot === 'hand') { worst = Math.min(worst, row.overlap); if (gap) bad++; }
    }
    const j = r.rows.map((x) => x.joint);
    console.log(`  joint: min ${Math.min(...j).toFixed(4)}  max ${Math.max(...j).toFixed(4)}  ` +
                `spread ${(Math.max(...j) - Math.min(...j)).toExponential(1)}`);
  }
  if (cases.length === 2) {
    console.log(bad === 0
      ? `\n✅ the hand never leaves the leg — worst overlap over the plan is +${worst.toFixed(4)}`
      : `\n✖ ${bad} frame(s) still detached`);
    process.exit(bad === 0 ? 0 : 1);
  }
}
