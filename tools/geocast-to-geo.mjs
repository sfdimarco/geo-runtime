// ═══════════════════════════════════════════════════════════════════════════
// .geocast → .geo v0
//
// The existing asset is the test input. Nothing is hand-authored.
//
// ⚠⚠ THE COMPILER REFUSES WHAT THE ISA CANNOT REPRESENT, and names the key.
//   "Unify by restriction" only means something if the restriction is enforced
//   at the boundary. A compiler that silently drops a pose channel produces a
//   binary that renders a DIFFERENT character and reports success — which is
//   the fail-open shape this project keeps meeting.
//
// See docs/GEO-V0-SPEC.md.
// ═══════════════════════════════════════════════════════════════════════════

const HEADER = 64, PART = 96, CHAN = 48, BEAT = 24;

// GeoV's own defaults — GC_DEF, read out of the engine, not guessed.
const GC_DEF = {
  solid: { k: 0.35, x: 0 },
  limb: { w: 0.022, taper: 0.78, handScale: 1.2, seat: 0.86 },
};

const PROF = { ball: 0, pinch: 1, cone: 2, slab: 3, pear: 4, sack: 5, tube: 6 };

/** Channels a v0 pose can carry. Anything else is a compile error. */
const POSE_KEYS = new Set(['from', 'mid', 'to', 'w', 'taper', 'off']);
/** Kinds that produce geometry. `eyes` and `face` are DRAWING, and the engine
 *  skips them in gcBuildForm too — that is a documented skip, not a refusal. */
const GEOM_KINDS = new Set(['solid', 'limb', 'leaf', 'patch']);

class Refused extends Error {}
const refuse = (msg) => { throw new Refused(`.geo v0 cannot express ${msg}`); };

const dwOf = (part, doc) => {
  const v = (part && part.dw != null) ? part.dw : (doc && doc.dw != null) ? doc.dw : 1;
  return Math.max(0.15, Math.min(2.0, +v || 1));
};
const def = (part, kindKey, key, fallback) => {
  if (part && part[key] !== undefined) return part[key];
  const d = GC_DEF[kindKey];
  return (d && d[key] !== undefined) ? d[key] : fallback;
};
const endNorm = (e) => {
  if (!e) return { r: 0, az: Math.PI / 2, y: 0.5 };
  if (Array.isArray(e)) {
    const x = +e[0] || 0;
    return { r: Math.abs(x), az: x < 0 ? -Math.PI / 2 : Math.PI / 2, y: +e[1] || 0 };
  }
  return { r: e.r === undefined ? 0 : +e.r,
           az: e.az === undefined ? Math.PI / 2 : +e.az,
           y: e.y === undefined ? 0.5 : +e.y };
};
const rgb = (hex, fallback = '#9AA3B2') => {
  const h = (typeof hex === 'string' && /^#?[0-9a-f]{6}$/i.test(hex)) ? hex : fallback;
  return parseInt(h.replace('#', ''), 16) & 0xFFFFFF;
};

/** gcPlanLength, exactly. */
export function planLength(plan) {
  return plan.length ? Math.max(0.4, (plan[plan.length - 1].t || 0) + 0.5) : 0;
}

/**
 * @param {object} doc  a normalised .geocast document
 * @param {object} res  resolution overrides; defaults are GeoV's own
 * @returns {{bin: Uint8Array, info: object}}
 */
export function compile(doc, res = {}) {
  const R = {
    loft_u: 26, loft_v: 26, sweep_nu: 16, noodle_nv: 20,
    mitt_u: 20, mitt_v: 16, leaf_u: 20, leaf_v: 16, ...res,
  };
  for (const [k, v] of Object.entries(R)) {
    if (!Number.isInteger(v) || v < 1 || v > 255) refuse(`resolution ${k}=${v} (1..255)`);
  }

  const pal = doc.pal || {};
  const col = (k, d) => (k && pal[k]) ? pal[k] : d;

  // ── parts ───────────────────────────────────────────────────────────────
  const src = (doc.parts || []).filter((p) => GEOM_KINDS.has(p.kind));
  const skipped = (doc.parts || []).length - src.length;
  if (src.length === 0) refuse('a document with no geometry parts');
  if (src.length > 255) refuse(`${src.length} parts (max 255 — host index is one byte)`);

  const index = new Map(src.map((p, i) => [p.id, i]));

  let nSolids = 0, nLimbs = 0, nHands = 0, nLeaves = 0;
  const parts = Buffer.alloc(src.length * PART);
  src.forEach((p, i) => {
    const b = i * PART;
    const isLeaf = p.kind === 'leaf' || p.kind === 'patch';
    const kind = p.kind === 'solid' ? 0 : p.kind === 'limb' ? 1 : 2;
    const off = !!p.off;
    const hand = p.kind === 'limb' && !!p.hand;

    if (isLeaf && p.tilt) refuse(`a leaf with tilt (part "${p.id}") — v0 has no tilt slot`);
    if (p.host !== undefined && !index.has(p.host)) {
      refuse(`part "${p.id}" hosted on "${p.host}", which is not a geometry part`);
    }

    if (!off) {
      if (kind === 0) nSolids++;
      else if (kind === 1) { nLimbs++; if (hand) nHands++; }
      else nLeaves++;
    }

    const K = p.k === undefined ? GC_DEF.solid.k : p.k;
    const shape = p.shape || 'tube';
    if (kind === 0 && !(shape in PROF)) refuse(`profile "${shape}" (part "${p.id}")`);
    const profId = kind === 0 ? PROF[shape] : PROF.tube;
    // the resolved profile parameter, not the authored k
    const profK = shape === 'cone' ? 0.30 + 0.60 * (1 - K)
                : (shape === 'pinch' || shape === 'slab') ? K : 0;

    parts.writeUInt8(kind, b);
    parts.writeUInt8((off ? 1 : 0) | (hand ? 2 : 0), b + 1);
    parts.writeUInt8(p.host !== undefined ? index.get(p.host) : 0xFF, b + 2);
    parts.writeUInt8(profId, b + 3);
    parts.writeUInt32LE(rgb(col(p.a, '#9AA3B2')), b + 4);
    parts.writeUInt32LE(rgb(col(p.b === undefined ? p.a : p.b, col(p.a, '#9AA3B2'))), b + 8);

    const w = kind === 0 ? (p.w == null ? 0.16 : p.w)
            : kind === 1 ? (p.w == null ? GC_DEF.limb.w : p.w)
            : (p.w == null ? 0.16 : p.w);
    const y0 = isLeaf ? (p.y == null ? 0.2 : p.y) : (p.y ? p.y[0] : 0.3);
    const y1 = isLeaf ? 0 : (p.y ? p.y[1] : 0.9);

    const f32 = [
      p.x || 0, y0, y1, w, profK, dwOf(p, doc),
      def(p, 'limb', 'taper', 0.18),
      def(p, 'limb', 'seat', 1),
      def(p, 'limb', 'handScale', 1),
    ];
    f32.forEach((v, j) => parts.writeFloatLE(v, b + 12 + j * 4));

    const e = (x) => { const n = endNorm(x); return [n.r, n.az, n.y]; };
    e(p.from).forEach((v, j) => parts.writeFloatLE(v, b + 48 + j * 4));
    e(p.mid).forEach((v, j) => parts.writeFloatLE(v, b + 60 + j * 4));
    e(p.to).forEach((v, j) => parts.writeFloatLE(v, b + 72 + j * 4));

    parts.writeFloatLE(isLeaf ? (p.bow == null ? 0.35 : p.bow) : 0, b + 84);
    parts.writeFloatLE(isLeaf ? (p.h == null ? 0.22 : p.h) : 0, b + 88);
    parts.writeFloatLE(isLeaf ? (p.az || 0) : 0, b + 92);
  });

  // ── poses ───────────────────────────────────────────────────────────────
  const poseNames = Object.keys(doc.poses || {});
  const poseIdx = new Map(poseNames.map((n, i) => [n, i]));
  const poses = Buffer.alloc(Math.max(1, poseNames.length) * src.length * CHAN);
  poseNames.forEach((name, pi) => {
    const P = doc.poses[name] || {};
    for (const id of Object.keys(P)) {
      if (!index.has(id)) continue;               // a pose for a drawing part
      const i = index.get(id);
      const d = P[id] || {};
      const b = (pi * src.length + i) * CHAN;
      let mask = 0;
      for (const key of Object.keys(d)) {
        if (!POSE_KEYS.has(key)) {
          refuse(`pose "${name}" setting "${key}" on part "${id}" — v0 poses carry ${[...POSE_KEYS].join(', ')}`);
        }
      }
      if (d.from) { mask |= 1;  const n = endNorm(d.from); [n.r, n.az, n.y].forEach((v, j) => poses.writeFloatLE(v, b + 4 + j * 4)); }
      if (d.mid)  { mask |= 2;  const n = endNorm(d.mid);  [n.r, n.az, n.y].forEach((v, j) => poses.writeFloatLE(v, b + 16 + j * 4)); }
      if (d.to)   { mask |= 4;  const n = endNorm(d.to);   [n.r, n.az, n.y].forEach((v, j) => poses.writeFloatLE(v, b + 28 + j * 4)); }
      if (d.w !== undefined)     { mask |= 8;  poses.writeFloatLE(+d.w, b + 40); }
      if (d.taper !== undefined) { mask |= 16; poses.writeFloatLE(+d.taper, b + 44); }
      if (d.off !== undefined)   { mask |= 32; if (d.off) mask |= 0; }
      poses.writeUInt8(mask, b);
    }
  });

  // ── plan ────────────────────────────────────────────────────────────────
  const plan = (doc.plan || []).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
  const beats = Buffer.alloc(Math.max(1, plan.length) * BEAT);
  plan.forEach((k, i) => {
    if (!poseIdx.has(k.pose)) refuse(`plan beat ${i} referencing unknown pose "${k.pose}"`);
    const b = i * BEAT;
    beats.writeUInt16LE(poseIdx.get(k.pose), b);
    const hasH = !!(k.ho || k.hi);
    beats.writeUInt16LE(hasH ? 1 : 0, b + 2);
    beats.writeFloatLE(k.t || 0, b + 4);
    const ho = k.ho || [1 / 3, 0], hi = k.hi || [-1 / 3, 0];
    [ho[0], ho[1], hi[0], hi[1]].forEach((v, j) => beats.writeFloatLE(v, b + 8 + j * 4));
    if (k.feel && !hasH) {
      refuse(`plan beat ${i} with feel "${k.feel}" — v0 carries explicit handles, so resolve the feel before compiling`);
    }
  });

  // ── the ceiling, computed here and written into the header ─────────────
  const gv = (u, v) => (u + 1) * (v + 1);
  const gi = (u, v) => u * v * 6;
  const maxVerts = nSolids * gv(R.loft_u, R.loft_v)
                 + nLimbs * gv(R.sweep_nu, R.noodle_nv)
                 + nHands * gv(R.mitt_u, R.mitt_v)
                 + nLeaves * gv(R.leaf_u, R.leaf_v);
  const maxIdx = nSolids * gi(R.loft_u, R.loft_v)
               + nLimbs * gi(R.sweep_nu, R.noodle_nv)
               + nHands * gi(R.mitt_u, R.mitt_v)
               + nLeaves * gi(R.leaf_u, R.leaf_v);

  const partsOff = HEADER;
  const posesOff = partsOff + parts.length;
  const planOff = posesOff + poses.length;
  const total = planOff + beats.length;

  const h = Buffer.alloc(HEADER);
  h.writeUInt32LE(0x304F4547, 0);                       // "GEO0"
  h.writeUInt16LE(0, 4);
  h.writeUInt16LE(doc.loop === false ? 0 : 1, 6);
  h.writeUInt16LE(src.length, 8);
  h.writeUInt16LE(poseNames.length, 10);
  h.writeUInt16LE(plan.length, 12);
  h.writeUInt16LE(nSolids, 14);
  h.writeUInt16LE(nLimbs, 16);
  h.writeUInt16LE(nHands, 18);
  h.writeUInt16LE(nLeaves, 20);
  h.writeUInt8(R.loft_u, 22);   h.writeUInt8(R.loft_v, 23);
  h.writeUInt8(R.sweep_nu, 24); h.writeUInt8(R.noodle_nv, 25);
  h.writeUInt8(R.mitt_u, 26);   h.writeUInt8(R.mitt_v, 27);
  h.writeUInt8(R.leaf_u, 28);   h.writeUInt8(R.leaf_v, 29);
  h.writeUInt16LE(0, 30);
  h.writeFloatLE(dwOf(null, doc), 32);
  h.writeFloatLE(planLength(plan), 36);
  h.writeUInt32LE(maxVerts, 40);
  h.writeUInt32LE(maxIdx, 44);
  h.writeUInt32LE(partsOff, 48);
  h.writeUInt32LE(posesOff, 52);
  h.writeUInt32LE(planOff, 56);
  h.writeUInt32LE(total, 60);

  const bin = Buffer.concat([h, parts, poses, beats], total);
  return {
    bin: new Uint8Array(bin),
    info: {
      bytes: total, parts: src.length, skippedDrawingParts: skipped,
      solids: nSolids, limbs: nLimbs, hands: nHands, leaves: nLeaves,
      poses: poseNames.length, beats: plan.length,
      maxVerts, maxIdx, planEnd: planLength(plan),
      sections: { header: HEADER, parts: parts.length, poses: poses.length, plan: beats.length },
    },
  };
}

export { Refused };
