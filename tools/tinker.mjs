// ═══════════════════════════════════════════════════════════════════════════
// tools/tinker.mjs — THE TINKER LOOP, as a tool.
//
//   ⭐⭐⭐ BEFORE MAKING THE ART, BUILD THE SWEEP.
//
// Generated visual work comes out lifeless for a reason that has nothing to do
// with taste: THE FEEDBACK LOOP IS TOO SLOW TO ACTUALLY TINKER. At a minute a
// look you get maybe fifteen looks in a session, so you make large blind
// structural changes and check them an hour apart, and what ships is the
// AVERAGE OF YOUR GUESSES. Someone drawing looks at the page several times a
// second.
//
// Booting the runtime is the expensive part; a variant after that is cheap. So
// the kernel is instantiated ONCE per call and every variant is `K.load(bin)`
// into the same instance — amortise the boot across thirty variants and one
// call buys thirty looks instead of one.
//
// The four rules this file implements, and they are not decoration:
//   1. ONE SESSION, MANY VARIANTS.
//   2. THE REFERENCE PINNED IN FRAME — judging a variant with no reference
//      visible is the most reliable way to drift to generic, and you will not
//      notice the drift; that is what drift is.
//   3. LABELS THAT SHOW ONLY WHAT VARIES. A sheet you have to cross-reference
//      against a caption is a sheet you read slowly.
//   4. ONE VARIABLE PER SWEEP. Two axes is a grid. Four is a lottery ticket.
//   And `ab()` for deciding: grids are for exploring, pairs are for judging.
//
// ⚠ EVERY TILE GOES THROUGH `drawCel` — the SAME rasteriser `geo_render` uses.
//   A sweep rendered through a different path tells you about the sweep.
//
// ⭐ SHOW THE HUMAN THE SHEET, NOT YOUR CONCLUSION. Both functions return the
//   numbers beside the picture and no verdict.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { loadKernel, ROOT, Rejected } from '../bench/kernel.mjs';
import { compile, Refused } from './geocast-to-geo.mjs';
import { encodeGIF } from './gif.mjs';
import { encodePNG, canvasOf, text, textWidth, drawCel, planBarInto, celBorder, boundsOf, BG } from './render.mjs';

const LABEL_H = 22;                       // a band the mesh never draws into
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const readCast = (c) => (c.cast ? structuredClone(c.cast)
  : JSON.parse(fs.readFileSync(abs(c.cast_path), 'utf8')));

/**
 * Resolve a dotted path into a .geocast, ARRAYS ADDRESSED BY `id`.
 * `parts.legL.handLen` · `poses.stomp.legL.to.y` · `dw`
 * ⚠ It refuses a path that does not exist rather than creating one — a sweep
 *   over a key nobody reads renders the same picture N times and looks like a
 *   result.
 */
export function poke(doc, dotted, value) {
  const seg = dotted.split('.');
  let cur = doc;
  for (let i = 0; i < seg.length - 1; i++) {
    const k = seg[i];
    const next = Array.isArray(cur) ? cur.find((e) => e && e.id === k) : cur[k];
    if (next == null || typeof next !== 'object') {
      throw new Error(`axis "${dotted}" — nothing at "${seg.slice(0, i + 1).join('.')}"`);
    }
    cur = next;
  }
  const last = seg[seg.length - 1];
  const holder = Array.isArray(cur) ? cur.find((e) => e && e.id === last) : cur;
  if (Array.isArray(cur)) throw new Error(`axis "${dotted}" ends on a list element, not a value`);
  if (!(last in holder)) {
    throw new Error(`axis "${dotted}" — "${last}" is not set on that object, so sweeping it ` +
                    `would compare a default against itself. Author it once, then sweep.`);
  }
  holder[last] = value;
  return doc;
}

/** Compile + load one variant into an ALREADY BOOTED kernel. */
function variant(K, doc, res) {
  try {
    const { bin, info } = compile(doc, res);
    const header = K.load(bin);
    return { ok: true, bin, info, header };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, refused: e.message };
    if (e instanceof Rejected) return { ok: false, rejected: e.message, code: e.rc };
    throw e;
  }
}

function writeOut(out, buf) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  return path.resolve(out);
}

// ═══ ab — 2..4 finalists, big enough to actually judge ═════════════════════
// Grids are for exploring. Pairs are for deciding. This is the before/after.
export async function ab({
  casts, times = null, t = null, window: win = null,
  cell = [300, 400], gif = false, fps = 10, out = null, res, bg = BG,
} = {}) {
  if (!Array.isArray(casts) || casts.length < 2) throw new Error('ab() needs at least two casts');
  if (casts.length > 4) throw new Error('ab() takes at most four — beyond that use sweep()');
  const K = await loadKernel();                       // ⭐ ONCE
  const [CW, CH0] = cell, CH = CH0 + LABEL_H;

  const loaded = casts.map((c, i) => {
    const doc = readCast(c);
    const v = variant(K, doc, res);
    return { label: c.label ?? `#${i}`, doc, ...v };
  });
  const bad = loaded.filter((l) => !l.ok);
  if (bad.length) {
    return { ok: false, variants: loaded.map(({ label, ok, refused, rejected }) => ({ label, ok, refused, rejected })),
             note: 'A refusal names its key. Fix the cast, or sweep a key the ISA has.' };
  }

  const planEnd = Math.max(...loaded.map((l) => l.header.planEnd ?? 1));
  const N = times ? times.length : (t != null ? 1 : (gif ? Math.max(2, Math.round(planEnd * fps)) : 6));
  const T = times ?? (t != null ? [t]
    : Array.from({ length: N }, (_, i) => (gif ? i / N : i / Math.max(1, N - 1)) * planEnd));

  // ⚠ ONE BOX ACROSS EVERY VARIANT AND EVERY TIME. A variant that silently
  //   rescales is not a comparison, it is two different pictures.
  let box = win;
  if (!box) {
    const boxes = loaded.map((l) => { K.load(l.bin); return boundsOf(K, T); });
    box = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
           Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  }

  const M = loaded.length;
  const report = loaded.map((l) => ({ label: l.label, bytes: l.info.bytes,
    ceiling: l.header.maxVerts, parts: l.info.parts, profiled_hands: l.info.profiledHands, frames: [] }));

  const drawPanel = (dst, DW, ox, oy, li, ti) => {
    const l = loaded[li];
    K.load(l.bin);
    const b = K.build(T[ti]);
    drawCel(dst, DW, ox, oy + LABEL_H, CW, CH0, K.meshView(), K.idxView(), b.stride, box);
    planBarInto(dst, DW, ox, oy + LABEL_H, CW, CH0, T[ti], l.header.planEnd ?? 1);
    celBorder(dst, DW, ox, oy, CH, li === 0 ? [44, 48, 56] : [216, 52, 43]);
    text(dst, DW, l.label, ox + 8, oy + 6, 2, li === 0 ? [150, 156, 168] : [236, 240, 248]);
    if (report[li].frames.length <= ti) {
      report[li].frames.push({ t: +T[ti].toFixed(4), verts: b.verts,
        within_ceiling: b.verts <= l.header.maxVerts, overflow: b.overflow });
    }
  };

  let buf, W, H;
  if (gif) {                                  // variants SIDE BY SIDE, one loop
    W = CW * M; H = CH;
    const cels = T.map((_, ti) => {
      const px = canvasOf(W, H, bg);
      for (let li = 0; li < M; li++) drawPanel(px, W, li * CW, 0, li, ti);
      return px;
    });
    buf = encodeGIF(cels, W, H, { delay: Math.max(2, Math.round(100 / fps)), loop: 0 });
  } else {                                    // one ROW per variant, time across
    W = CW * T.length; H = CH * M;
    const px = canvasOf(W, H, bg);
    for (let li = 0; li < M; li++) for (let ti = 0; ti < T.length; ti++) {
      drawPanel(px, W, ti * CW, li * CH, li, ti);
    }
    buf = encodePNG(px, W, H);
  }
  const file = writeOut(out ?? (gif ? 'bench/results/ab.gif' : 'bench/results/ab.png'), buf);
  return { ok: true, out: file, format: gif ? 'gif' : 'png', size: `${W}x${H}`,
           bytes: buf.length, times: T.map((x) => +x.toFixed(4)), window: box.map((x) => +x.toFixed(4)),
           fps: gif ? fps : undefined, palette_exact: gif ? !!buf.paletteExact : undefined,
           variants: report,
           note: 'Pairs are for DECIDING. Look at the picture and pick; the numbers are beside it ' +
                 'so a small motion cannot hide. No verdict is offered on purpose.' };
}

// ═══ sweep — ONE axis, many values, the reference pinned in frame ══════════
export async function sweep({
  cast = null, cast_path = null, axis, values, t = 0, window: win = null,
  cell = [220, 300], cols = 6, out = null, res, bg = BG, reference = true,
} = {}) {
  if (!axis || !Array.isArray(values) || values.length < 2) {
    throw new Error('sweep() needs an axis and at least two values');
  }
  if (values.length > 40) throw new Error('sweep() takes at most 40 values in one sheet');
  const K = await loadKernel();                       // ⭐ ONCE
  const [CW, CH0] = cell, CH = CH0 + LABEL_H;
  const base = cast ? structuredClone(cast)
    : JSON.parse(fs.readFileSync(abs(cast_path ?? 'bench/reference/v36-test-character-boots.geocast'), 'utf8'));
  const leaf = axis.split('.').pop();

  // ⭐ RULE 2 — the reference is TILE ZERO, in the same frame, every time.
  const tiles = [];
  if (reference) tiles.push({ label: 'REF', doc: structuredClone(base), ref: true });
  for (const v of values) {
    tiles.push({ label: `${leaf}=${v}`, value: v, doc: poke(structuredClone(base), axis, v) });
  }

  for (const tile of tiles) Object.assign(tile, variant(K, tile.doc, res));

  let box = win;
  if (!box) {
    const boxes = tiles.filter((x) => x.ok).map((x) => { K.load(x.bin); return boundsOf(K, [t]); });
    if (!boxes.length) {
      return { ok: false, axis, variants: tiles.map(({ label, refused, rejected }) => ({ label, refused, rejected })),
               note: 'Every variant was refused. A refusal names its key.' };
    }
    box = [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
           Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
  }

  const C = Math.min(cols, tiles.length), R = Math.ceil(tiles.length / C);
  const W = C * CW, H = R * CH;
  const px = canvasOf(W, H, bg);
  const report = [];
  tiles.forEach((tile, i) => {
    const ox = (i % C) * CW, oy = Math.floor(i / C) * CH;
    if (!tile.ok) {
      text(px, W, tile.label, ox + 8, oy + 6, 2, [150, 156, 168]);
      text(px, W, 'REFUSED', ox + 8, oy + CH / 2, 2, [216, 52, 43]);
      celBorder(px, W, ox, oy, CH, [216, 52, 43]);
      report.push({ label: tile.label, value: tile.value, ok: false,
                    refused: tile.refused, rejected: tile.rejected });
      return;
    }
    K.load(tile.bin);
    const b = K.build(t);
    drawCel(px, W, ox, oy + LABEL_H, CW, CH0, K.meshView(), K.idxView(), b.stride, box);
    celBorder(px, W, ox, oy, CH, tile.ref ? [236, 200, 46] : [44, 48, 56]);
    text(px, W, tile.label, ox + 8, oy + 6, 2, tile.ref ? [236, 200, 46] : [214, 218, 228]);
    report.push({ label: tile.label, value: tile.value, ok: true, bytes: tile.info.bytes,
                  ceiling: tile.header.maxVerts, verts: b.verts,
                  within_ceiling: b.verts <= tile.header.maxVerts, overflow: b.overflow });
  });

  const buf = encodePNG(px, W, H);
  const file = writeOut(out ?? 'bench/results/sweep.png', buf);
  return { ok: true, out: file, axis, t, size: `${W}x${H}`, bytes: buf.length,
           window: box.map((x) => +x.toFixed(4)), variants: report,
           note: 'ONE AXIS. The reference is the yellow tile. Sweep WIDE — include values you ' +
                 'are sure are wrong; they are cheap and they calibrate the ones you think are ' +
                 'right. Pick by eye, freeze the winner, sweep the next axis.' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2);
  const flag = (n) => { const i = a.indexOf('--' + n); return i < 0 ? null : a[i + 1]; };
  const nums = (s) => s.split(',').map(Number);
  if (a[0] === 'sweep') {
    const r = await sweep({ cast_path: flag('cast'), axis: flag('axis'),
      values: nums(flag('values')), t: flag('t') ? +flag('t') : 0,
      window: flag('window') ? nums(flag('window')) : null,
      cell: flag('cell') ? nums(flag('cell')) : [220, 300],
      cols: flag('cols') ? +flag('cols') : 6, out: flag('out') });
    console.log(`${r.out}  ${r.size}  ${(r.bytes/1024).toFixed(0)} KB`);
    for (const v of r.variants) console.log(`  ${(v.label + '            ').slice(0, 14)}` +
      (v.ok ? `${String(v.bytes).padStart(6)} B  ceiling ${v.ceiling}  verts ${v.verts}` : `REFUSED — ${v.refused ?? v.rejected}`));
  } else {
    const paths = (flag('casts') ?? 'bench/reference/v36-test-character.geocast,bench/reference/v36-test-character-boots.geocast').split(',');
    const labels = (flag('labels') ?? 'BEFORE,AFTER').split(',');
    const r = await ab({ casts: paths.map((p, i) => ({ cast_path: p, label: labels[i] ?? p })),
      gif: a.includes('--gif'), fps: flag('fps') ? +flag('fps') : 10,
      window: flag('window') ? nums(flag('window')) : null,
      cell: flag('cell') ? nums(flag('cell')) : [300, 400],
      times: flag('times') ? nums(flag('times')) : null, out: flag('out') });
    console.log(`${r.out}  ${r.size}  ${(r.bytes/1024).toFixed(0)} KB`);
    for (const v of r.variants) console.log(`  ${v.label}: ${v.bytes} B · ceiling ${v.ceiling} · ` +
      `${v.frames.length} frames · all inside: ${v.frames.every(f => f.within_ceiling)}`);
  }
}
