// mcp/look.mjs — geo_look: let Jev LOOK at a .geo program.
//
// WHY THIS EXISTS. geo_render shows a picture to a model that can see. Jev
// (TypeSafe's System One decision model) cannot see pixels — it reads text and
// JSON only. The 2026-09-26 kill switch measured what it CAN read:
//
//     picture -> GEO quadtree -> flattened 16x16 colour-word grid -> Jev
//       placement 18/18 · 2-D grouping 20/22 · no apophenia · no hallucination
//     the raw nested quadtree -> Jev: 8/18 — Jev does NOT read the nesting.
//
// So this tool renders frames THROUGH THE SAME RASTERISER AS geo_render (there is
// only one, on purpose), turns each frame into that exact grid, and asks Jev typed
// questions about all of them in ONE call.
//
// ⭐⭐ EVERY PRESET QUESTION CARRIES ITS OWN CONTROL. The same grid is measured in
//   code (is anything there, which ninth, does it touch the edge, how many
//   pieces), and every Jev answer is returned beside that measurement with
//   `agrees`. For these presets the code is the ground truth — they exist to
//   CALIBRATE Jev on your frames. Custom questions are where Jev adds something
//   the code cannot say, and there it has no control: read them as a judgement.
//
// ⚠ ONE ANSWER EVERY ~5 MINUTES. That is TypeSafe's limit on this account
//   (measured: 27 gaps of 307–308 s), not Vercel's and not this code's. So one
//   call carries several frames x several questions, and a rate-limited call
//   comes back FAST with the grids and a retry time instead of hanging.
//
// ⚠ THE KEY NEVER LEAVES THIS PC and is never printed. Looked up in order:
//   AI_GATEWAY_API_KEY in the environment · the file named by GEO_JEV_ENV ·
//   ../jev-lab/.env.local beside this repo. dry_run needs no key at all.
//
// ⚠ AUTO-FRAMING HIDES "OFF SCREEN". With no window, the box is fitted to the
//   subject across all the times, so nothing can leave the frame. Pass a window
//   (MESH coordinates, y_mesh = 1 - y_cast) to judge a real camera framing.
//
// 👁 THE GLANCE (2026-09-28, all additive — every default below is the old behaviour, byte for byte)
//   transport  vercel | openrouter | typesafe | auto (default). auto takes the first key it finds:
//              OPENROUTER_API_KEY, TYPESAFE_API_KEY, then AI_GATEWAY_API_KEY (same env / file lookup
//              as before). The 5-minute wall was measured on the Vercel route only; the Vercel body
//              is unchanged. OpenRouter and TypeSafe speak TypeSafe's native shape (noul, not
//              boolean) — translated here both ways, so the reply looks the same whichever route ran.
//   grids      a third door: 16 x 16 colour words straight in (a game state, a test pattern).
//   palette    'kill_switch' (default: the 19 words the kill switch measured) | 'fine' (+15 words:
//              cream, peach, lavender, mint, olive …). Measured: through the 19 words a pastel
//              world is tan / grey / light_grey, and Jev read four different day-lights as one
//              "midday" (SQUARE EYES call04). The squint's vocabulary is a variable — test it.
//   control    'scramble': every frame gets a twin with the SAME words in shuffled places
//              (fixed seed). Colour statistics identical, layout destroyed. Each answer comes
//              back with layout_effect = real − twin: near 0 means Jev read colour, not layout.
//              Measured: time of day / warmth barely move (colour); "together vs apart" moves
//              0.63 → 0.25 on grids with identical words (layout). Also per image: scramble: <seed>.
//   compare    questions asked ONCE about all the frames together (no "look only at frame fN" lead):
//              likeness to a reference, A/B, "which frame…". The tinker loop's ab(), with Jev as the glance.
//   baseline   (legend 'scene' / grids) colour statistics of the very grid Jev reads — lum,
//              warmth, sat, busy, word counts. A judgement is only news where it beats these.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadCast, loadKernel, ROOT } from '../bench/kernel.mjs';
import { drawCel, boundsOf, canvasOf, encodePNG, text, BG } from '../tools/render.mjs';

const W = 256;               // power of two, so the codec's pow2 padding never kicks in
const MAXD = 8;              // log2(W): pixel level
const D = 4;                 // the depth that measured 18/18 and 20/22: a 16 x 16 grid
const N = 1 << D, CELL = W / N;
const QUALITY = 245;         // the codec's default
const MODEL = 'typesafe-ai/jev';
const ENDPOINT = process.env.JEV_ENDPOINT || 'https://ai-gateway.vercel.sh/v1/evaluate';
const STATE_TOKEN_CAP = 30000;   // Jev's documented state limit is 32K tokens
const OUT_DIR = process.env.GEO_LOOK_OUT ? path.resolve(process.env.GEO_LOOK_OUT) : path.join(ROOT, 'bench/results/look');

// ── the routes to Jev. Same questions, same state; only the envelope differs. ──
//   vercel      https://ai-gateway.vercel.sh/v1/evaluate     boolean/choice/score · measured 1 answer / ~307 s on this account
//   openrouter  https://openrouter.ai/api/alpha/decisions    noul/choice/score (TypeSafe's shape) · model typesafe/jev-1.13
//   typesafe    https://api.typesafe.ai/v1/systemone         noul/choice/score · 1,200 requests/min documented (waitlist)
const TRANSPORTS = {
  vercel:     { env: 'AI_GATEWAY_API_KEY', url: () => ENDPOINT, native: false, paced_s: 310 },
  openrouter: { env: 'OPENROUTER_API_KEY', url: () => process.env.JEV_ENDPOINT_OPENROUTER || 'https://openrouter.ai/api/alpha/decisions',
                model: () => process.env.JEV_MODEL_OPENROUTER || 'typesafe/jev-1.13', native: true, paced_s: 0 },
  typesafe:   { env: 'TYPESAFE_API_KEY', url: () => process.env.JEV_ENDPOINT_TYPESAFE || 'https://api.typesafe.ai/v1/systemone',
                model: () => process.env.JEV_MODEL_TYPESAFE || null, native: true, paced_s: 0 },
};
const AUTO_ORDER = ['openrouter', 'typesafe', 'vercel'];

// ── the codec, mirrored exactly as the kill switch did it ────────────────────
// BinaryQuadTreeCPUTest/go/pkg/quadtree/builder.go: JFIF RGB->YCbCr, bottom-up to
// pixel depth, parent = floor((a+b+c+d+2)/4), prune only when all 4 children are
// leaves within (255-quality) on Y and 2x that on Cb/Cr, children TL TR BL BR.
const clampU8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.floor(v + 0.5));
const rgbToYcc = (r, g, b) => [clampU8(0.299 * r + 0.587 * g + 0.114 * b),
  clampU8(128 - 0.168736 * r - 0.331264 * g + 0.5 * b), clampU8(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)];
function yccToRgb([Y, Cb, Cr]) {
  const cb = Cb - 128, cr = Cr - 128;
  return [clampU8(Y + 1.402 * cr), clampU8(Y - 0.344136 * cb - 0.714136 * cr), clampU8(Y + 1.772 * cb)];
}
function buildTree(px) {
  const ycc = new Uint8Array(W * W * 3);
  for (let i = 0; i < W * W; i++) { const c = rgbToYcc(px[i*3], px[i*3+1], px[i*3+2]); ycc[i*3] = c[0]; ycc[i*3+1] = c[1]; ycc[i*3+2] = c[2]; }
  const thr = 255 - QUALITY, cthr = thr * 2;
  function rec(x, y, s, d) {
    if (d === MAXD) { const i = (y * W + x) * 3; return { x, y, s, d, c: [ycc[i], ycc[i+1], ycc[i+2]], k: null }; }
    const h = s >> 1;
    const k = [rec(x, y, h, d+1), rec(x+h, y, h, d+1), rec(x, y+h, h, d+1), rec(x+h, y+h, h, d+1)];
    const c = [0, 1, 2].map(j => Math.floor((k[0].c[j] + k[1].c[j] + k[2].c[j] + k[3].c[j] + 2) / 4));
    let prune = true;
    for (const ch of k) {
      if (ch.k) { prune = false; break; }
      if (Math.abs(ch.c[0]-c[0]) > thr || Math.abs(ch.c[1]-c[1]) > cthr || Math.abs(ch.c[2]-c[2]) > cthr) { prune = false; break; }
    }
    return { x, y, s, d, c, k: prune ? null : k };
  }
  return rec(0, 0, W, 0);
}
function leavesAt(node, depth, out = []) {
  if (!node.k || node.d === depth) { out.push(node); return out; }
  for (const c of node.k) leavesAt(c, depth, out);
  return out;
}
// One naming step, identical to the kill switch, so the words mean what they meant there.
const PALETTE = [
  ['red', [214, 40, 57]], ['dark_red', [140, 22, 36]], ['pink', [232, 150, 180]], ['orange', [232, 140, 50]],
  ['brown', [120, 82, 52]], ['tan', [196, 168, 128]], ['yellow', [238, 208, 70]], ['green', [78, 140, 66]],
  ['dark_green', [42, 86, 46]], ['cyan', [70, 200, 215]], ['blue', [46, 86, 200]], ['sky_blue', [140, 184, 232]],
  ['pale_blue', [204, 224, 244]], ['purple', [126, 72, 164]], ['white', [246, 246, 246]], ['light_grey', [196, 196, 196]],
  ['grey', [128, 124, 116]], ['dark_grey', [72, 72, 72]], ['black', [16, 16, 16]],
];
// 👁 palette 'fine' (opt-in): the 19 words PLUS the in-between colours an illustrated world lives in.
// Measured 2026-09-28: through the 19 words, pastel grass reads tan and cream sky light_grey, so four
// different day-lights became the same grid. These 15 words are ordinary English colour names.
const FINE_EXTRA = [
  ['cream', [242, 234, 208]], ['beige', [222, 206, 174]], ['peach', [246, 196, 164]], ['salmon', [232, 132, 112]],
  ['rose', [214, 112, 136]], ['lavender', [188, 176, 222]], ['mauve', [168, 128, 160]], ['plum', [92, 52, 92]],
  ['navy', [32, 44, 96]], ['slate', [104, 116, 140]], ['teal', [42, 128, 136]], ['mint', [178, 226, 196]],
  ['light_green', [164, 210, 124]], ['olive', [128, 128, 64]], ['khaki', [190, 180, 124]],
];
const PALETTES = { kill_switch: PALETTE, fine: [...PALETTE, ...FINE_EXTRA] };
const PAL = Object.fromEntries([...PALETTE, ...FINE_EXTRA]);     // every word's colour (for sheets and baselines)
function nearestName([r, g, b], pal = PALETTE) {
  let best = null, bd = Infinity;
  for (const [n, [R2, G2, B2]] of pal) {
    const rm = (r + R2) / 2, dr = r - R2, dg = g - G2, db = b - B2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function gridOf(root, pal = PALETTE) {
  const g = new Array(N * N);
  for (const n of leavesAt(root, D)) {
    const nm = nearestName(yccToRgb(n.c), pal), c0 = n.x / CELL, r0 = n.y / CELL, sz = n.s / CELL;
    for (let r = r0; r < r0 + sz; r++) for (let c = c0; c < c0 + sz; c++) g[r * N + c] = nm;
  }
  return g;
}
const BG_WORD = nearestName(BG);   // what the renderer's empty background reads as
const LEGEND = `Each frame is a ${N} x ${N} grid of cells. picture[0] is the top row and picture[${N - 1}] is the bottom row. ` +
  `In each row the first word is the left edge and the last word is the right edge. Each word is the colour of one cell. ` +
  `${BG_WORD} cells are empty background; every cell that is not ${BG_WORD} is part of the subject.`;

// 👁 the scrambled twin: the same 256 words in shuffled places (seeded, so a twin is reproducible)
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function scrambleGrid(g, seed) {
  const rnd = mulberry32((seed >>> 0) || 1), idx = g.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.map(i => g[i]);
}
// 👁 the baseline: colour statistics of the very grid Jev reads. A judgement is news only where it beats these.
function baselineOf(g) {
  let L = 0, Wm = 0, S = 0, diff = 0; const cnt = {};
  for (const w of g) {
    const [r, gg, b] = PAL[w], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    L += (0.299 * r + 0.587 * gg + 0.114 * b) / 255; Wm += (r - b) / 255; S += mx ? (mx - mn) / mx : 0; cnt[w] = (cnt[w] || 0) + 1;
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (c < N - 1 && g[r * N + c] !== g[r * N + c + 1]) diff++;
    if (r < N - 1 && g[r * N + c] !== g[(r + 1) * N + c]) diff++;
  }
  const n = g.length;
  return { lum: +(L / n).toFixed(3), warmth: +(Wm / n).toFixed(3), sat: +(S / n).toFixed(3), busy: +(diff / (2 * N * (N - 1))).toFixed(3),
           n_words: Object.keys(cnt).length, top_words: Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, k]) => `${w} ${k}`) };
}

// ── 🖼 THE IMAGE DOOR (2026-09-27, additive, made for the SQUARE EYES eyes test) ───────
// geo_look was built to look at .geo programs. A film frame is a picture, so this door lets a PNG in:
//   args.images = [{ path, label? , t? , expect? }, …]   (1–8 pictures, 8-bit PNG, any size)
// Each picture is AREA-AVERAGED to 256 × 256 — the WHOLE frame, squashed, so the 16 × 16 grid covers
// exactly what the camera saw — and then goes through the SAME quadtree and the SAME colour words as a
// rendered cast. Nothing below this door changes.
//   legend: 'subject' (default) — the picture is a MATTE: the subject painted on the renderer's
//            background, exactly like a cast render, so every preset is measured in code as before.
//   legend: 'scene' — a whole scene with no empty background. The subject/background claim in the
//            legend would be false, so presets are refused; ask custom questions. A custom question can
//            carry a control after all: pass expect: { question: value } per picture (say in your
//            notes how you measured it) and each answer comes back with `expected` and `agrees`.
const LEGEND_SCENE = `Each frame is a ${N} x ${N} grid of cells. picture[0] is the top row and picture[${N - 1}] is the bottom row. ` +
  `In each row the first word is the left edge and the last word is the right edge. Each word is the colour of one cell. ` +
  `Each frame is a picture of a whole scene, so there is no empty background colour.`;
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('images must be PNG files');
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, inter = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; inter = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || inter !== 0 || ![0, 2, 4, 6].includes(ctype)) throw new Error(`PNG must be 8-bit, not interlaced, grey/RGB/RGBA (got depth ${depth}, colour type ${ctype}, interlace ${inter})`);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype], stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0; let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ctype === 2 || ctype === 6) { px[i * 3] = out[i * bpp]; px[i * 3 + 1] = out[i * bpp + 1]; px[i * 3 + 2] = out[i * bpp + 2]; }
    else px[i * 3] = px[i * 3 + 1] = px[i * 3 + 2] = out[i * bpp];
    if (ctype === 4 || ctype === 6) { const al = out[i * bpp + bpp - 1] / 255; for (let j = 0; j < 3; j++) px[i * 3 + j] = Math.round(px[i * 3 + j] * al + BG[j] * (1 - al)); }
  }
  return { w, h, px };
}
function area256({ w, h, px }) {     // exact area average: every source pixel counts by how much of it falls in the cell
  const out = new Uint8Array(W * W * 3), sx = w / W, sy = h / W;
  for (let Y = 0; Y < W; Y++) {
    const y0 = Y * sy, y1 = y0 + sy;
    for (let X = 0; X < W; X++) {
      const x0 = X * sx, x1 = x0 + sx; let r = 0, g = 0, b = 0, ws = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wt = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * wy, i = (yy * w + xx) * 3;
          r += px[i] * wt; g += px[i + 1] * wt; b += px[i + 2] * wt; ws += wt;
        }
      }
      const o = (Y * W + X) * 3; out[o] = Math.round(r / ws); out[o + 1] = Math.round(g / ws); out[o + 2] = Math.round(b / ws);
    }
  }
  return out;
}

// ── what code can MEASURE on the same grid: the control for every preset ────
const NINTHS = ['top_left', 'top_center', 'top_right', 'middle_left', 'center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right'];
function measure(g) {
  const on = [];
  for (let i = 0; i < g.length; i++) if (g[i] !== BG_WORD) on.push(i);
  if (!on.length) return { empty: true, where: 'none', touches_edge: false, one_object: 'none', coverage: 0, pieces: 0, edges: [] };
  let sx = 0, sy = 0; const edges = new Set();
  for (const i of on) {
    const c = i % N, r = Math.floor(i / N); sx += c + 0.5; sy += r + 0.5;
    if (r === 0) edges.add('top'); if (r === N - 1) edges.add('bottom'); if (c === 0) edges.add('left'); if (c === N - 1) edges.add('right');
  }
  const cx = sx / on.length / N, cy = sy / on.length / N;
  const col = Math.min(2, Math.floor(cx * 3)), row = Math.min(2, Math.floor(cy * 3));
  // connected pieces, 8-neighbour (corners touch) — the same rule the grouping test used
  const seen = new Set(), set = new Set(on); let pieces = 0;
  for (const s of on) {
    if (seen.has(s)) continue; pieces++; const st = [s]; seen.add(s);
    while (st.length) { const i = st.pop(), c = i % N, r = Math.floor(i / N);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc, j = rr * N + cc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && set.has(j) && !seen.has(j)) { seen.add(j); st.push(j); } } }
  }
  return { empty: false, where: NINTHS[row * 3 + col], touches_edge: edges.size > 0, one_object: pieces === 1 ? 'one_object' : 'scattered',
           coverage: +(on.length / g.length).toFixed(3), pieces, edges: [...edges] };
}

// ── the questions ────────────────────────────────────────────────────────────
const PRESETS = {
  empty: { type: 'boolean', instructions: `Is this frame empty — is every cell ${BG_WORD}?` },
  where: { type: 'choice', instructions: 'Split this frame into a 3 x 3 grid of equal ninths. Which ninth contains the centre of the subject? If the frame is empty, answer none.',
    criteria: Object.fromEntries([...NINTHS.map(n => [n, n.replace('_', ' ') + ' ninth of the frame']), ['none', `every cell is ${BG_WORD}`]]) },
  touches_edge: { type: 'boolean', instructions: 'Does the subject touch the outer edge of the frame (the top row, the bottom row, the first word of a row or the last word of a row)? That means it is cut off by the frame.' },
  one_object: { type: 'choice', instructions: 'Do the subject cells touch each other and make one connected shape, or are they separate pieces that do not touch? If the frame is empty, answer none.',
    criteria: { one_object: 'the subject cells make one connected shape', scattered: 'the subject cells are in separate pieces that do not touch', none: `every cell is ${BG_WORD}` } },
};
const truthOf = (name, m) => (name === 'empty' ? m.empty : name === 'touches_edge' ? m.touches_edge : m[name]);

function readKey(env = 'AI_GATEWAY_API_KEY') {
  if (process.env[env]) return process.env[env].trim();
  const files = [process.env.GEO_JEV_ENV, path.join(ROOT, '..', 'jev-lab', '.env.local')].filter(Boolean);
  const re = new RegExp(`^${env}=["']?([^"'\\r\\n]+)`, 'm');
  for (const f of files) {
    try { const k = (fs.readFileSync(f, 'utf8').match(re) || [])[1]; if (k) return k.trim(); } catch { /* next */ }
  }
  return null;
}
/** which route to Jev: args.transport, else JEV_TRANSPORT, else the first key found (openrouter, typesafe, vercel) */
function pickTransport(args) {
  const want = args.transport ?? process.env.JEV_TRANSPORT ?? 'auto';
  if (want !== 'auto') {
    if (!TRANSPORTS[want]) throw new Error(`unknown transport "${want}" (vercel | openrouter | typesafe | auto)`);
    return { name: want, key: readKey(TRANSPORTS[want].env) };
  }
  for (const name of AUTO_ORDER) { const key = readKey(TRANSPORTS[name].env); if (key) return { name, key }; }
  return { name: 'vercel', key: null };
}
// TypeSafe's native shape (OpenRouter, api.typesafe.ai) says noul where the gateway says boolean.
const toNative = (qs) => Object.fromEntries(Object.entries(qs).map(([k, q]) => [k, q.type === 'boolean' ? { ...q, type: 'noul' } : q]));
const fromNative = (as) => Object.fromEntries(Object.entries(as).map(([k, a]) =>
  [k, a && (a.type === 'noul' || (a.noul != null && a.probability == null)) ? { ...a, type: 'boolean', probability: a.noul } : a]));
function retryAfterS(h) {
  if (!h) return null; const n = Number(h); if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const t = Date.parse(h); return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : null;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lastPath = path.join(OUT_DIR, 'last-answer.json');
function lastAnswer() { try { return JSON.parse(fs.readFileSync(lastPath, 'utf8')); } catch { return null; } }

/** One picture: each frame beside the 16 x 16 grid Jev is handed. For a PERSON. */
function sheetOf(frames) {
  const S = 128, P = 6, LH = 22, Wd = frames.length * (2 * S + 3 * P), Hd = S + LH + P;
  const img = canvasOf(Wd, Hd, [12, 13, 16]);
  frames.forEach((f, i) => {
    const ox = i * (2 * S + 3 * P) + P;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const s = ((y * 2) * W + x * 2) * 3, d = ((LH + y) * Wd + ox + x) * 3;
      if (f.px) { img[d] = f.px[s]; img[d+1] = f.px[s+1]; img[d+2] = f.px[s+2]; }
      else { const q = PAL[f.grid[Math.floor(y / (S / N)) * N + Math.floor(x / (S / N))]]; img[d] = q[0]; img[d+1] = q[1]; img[d+2] = q[2]; }   // a grid came in: no picture
      const rgb = PAL[f.grid[Math.floor(y / (S / N)) * N + Math.floor(x / (S / N))]];
      const e = ((LH + y) * Wd + ox + S + P + x) * 3; img[e] = rgb[0]; img[e+1] = rgb[1]; img[e+2] = rgb[2];
    }
    text(img, Wd, `${f.id.toUpperCase()} T=${f.t.toFixed(2)}`, ox, 5, 2);
  });
  return encodePNG(img, Wd, Hd);
}

/**
 * geo_look. Renders frames, grids them, asks Jev, and returns every answer
 * beside the code's own measurement of the same grid.
 */
export async function look(args = {}, { readCast, abs }) {
  const presets = args.presets ?? ['empty', 'where', 'touches_edge'];
  for (const p of presets) if (!PRESETS[p]) throw new Error(`unknown preset "${p}" (known: ${Object.keys(PRESETS).join(', ')})`);
  const custom = args.questions ?? {};
  for (const [k, q] of Object.entries(custom)) {
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(k)) throw new Error(`question name "${k}" must be lower_snake_case, max 31 chars`);
    if (!['boolean', 'choice', 'score'].includes(q?.type)) throw new Error(`question "${k}" needs type boolean | choice | score`);
    if (!q.instructions) throw new Error(`question "${k}" needs instructions`);
  }
  // 👁 compare: questions asked ONCE about all the frames together (likeness, A/B, "which one…") — no per-frame lead
  const compare = args.compare ?? {};
  for (const [k, q] of Object.entries(compare)) {
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(k)) throw new Error(`compare question name "${k}" must be lower_snake_case, max 31 chars`);
    if (!['boolean', 'choice', 'score'].includes(q?.type)) throw new Error(`compare question "${k}" needs type boolean | choice | score`);
    if (!q.instructions) throw new Error(`compare question "${k}" needs instructions`);
  }
  // 👁 the squint's vocabulary
  const palName = args.palette ?? 'kill_switch';
  const pal = PALETTES[palName];
  if (!pal) throw new Error(`unknown palette "${palName}" (kill_switch | fine)`);
  if (args.control !== undefined && args.control !== 'scramble') throw new Error(`unknown control "${args.control}" (scramble)`);
  const tp = pickTransport(args), route = TRANSPORTS[tp.name];

  // 🖼 pictures (film frames) through the image door — or 16 x 16 words through the grid door — or a program, exactly as before
  const images = args.images ?? null, grids = args.grids ?? null;
  let from, frames, T, boxes = null, box = null, shots = null;
  if (images && grids) throw new Error('pass images OR grids, not both');
  if (images || grids) {
    const list = images ?? grids, what = images ? 'images' : 'grids';
    if (!Array.isArray(list) || list.length < 1 || list.length > 8) throw new Error(`1 to 8 ${what} per look`);
    if (args.geo_path || args.cast || args.cast_path || args.shots || args.times || args.window) throw new Error(`pass ${what} OR a program, not both`);
    if (args.legend === 'scene' && presets.length) throw new Error("presets assume an empty background — with legend 'scene' pass presets: [] and ask custom questions");
    from = what;
    frames = list.map((im, i) => {
      let pic = null, grid;
      if (images) { pic = area256(decodePNG(fs.readFileSync(abs(im.path)))); grid = gridOf(buildTree(pic), pal); }
      else {
        grid = Array.isArray(im.words) ? [...im.words] : Array.isArray(im.rows) ? im.rows.flatMap(r => String(r).trim().split(/\s+/)) : null;
        if (!grid || grid.length !== N * N) throw new Error(`grid ${i}: pass words (${N * N} colour words) or rows (${N} strings of ${N} words)`);
        const bad = grid.find(w => !PAL[w]); if (bad) throw new Error(`grid ${i}: "${bad}" is not a colour word (${Object.keys(PAL).join(' ')})`);
      }
      if (im.scramble !== undefined && im.scramble !== null && im.scramble !== false) grid = scrambleGrid(grid, Number(im.scramble) || 1);
      return { id: `f${i}`, label: im.label ?? (im.path ? path.basename(im.path) : `grid ${i}`), t: im.t ?? 0, px: pic, grid, measured: measure(grid),
               verts: null, within_ceiling: null, expect: im.expect ?? null, path: im.path, scrambled: im.scramble != null && im.scramble !== false };
    });
    T = frames.map(f => f.t);
  } else {
    // the program: a compiled .geo, or a cast compiled here — the same two doors as geo_render
    let K, header;
    if (args.geo_path) { K = await loadKernel(); header = K.load(new Uint8Array(fs.readFileSync(abs(args.geo_path)))); from = abs(args.geo_path); }
    else { const c = readCast(args); ({ K, header } = await loadCast(c.doc, { res: args.res })); from = c.from; }
    const planEnd = header.planEnd ?? 1;
    const nT = Math.max(1, Math.min(8, args.frames ?? 4));
    // SHOTS: one camera window per frame (a storyboard). Otherwise one shared box for every frame.
    shots = args.shots ?? null;
    if (shots && (shots.length < 1 || shots.length > 8)) throw new Error('1 to 8 shots per look');
    if (shots && (args.window || args.times)) throw new Error('pass shots OR times/window, not both');
    T = shots ? shots.map(s => s.t ?? 0)
      : args.times ?? Array.from({ length: nT }, (_, i) => (nT === 1 ? 0 : i / (nT - 1)) * planEnd);
    if (T.length > 8) throw new Error('at most 8 times per look — one call is one Jev answer, and bigger states read worse');

    // every box is SQUARED about its centre, so nothing is stretched
    const square = (b) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, h = Math.max(b[2] - b[0], b[3] - b[1]) / 2; return [cx - h, cy - h, cx + h, cy + h]; };
    const shared = shots ? null : square(args.window ?? boundsOf(K, T));
    boxes = shots ? shots.map(s => square(s.window)) : T.map(() => shared);
    box = shared ?? boxes[0];

    frames = T.map((t, i) => {
      const b = K.build(t), m = K.meshView(), ix = K.idxView();
      const px = canvasOf(W, W);
      drawCel(px, W, 0, 0, W, W, m, ix, b.stride, boxes[i]);
      const grid = gridOf(buildTree(px), pal);
      return { id: `f${i}`, t, px, grid, measured: measure(grid), verts: b.verts, within_ceiling: b.verts <= header.maxVerts };
    });


  }
  // 👁 control: 'scramble' — a twin per frame: the same words, shuffled (seed 1000 + i). Colour kept, layout gone.
  if (args.control === 'scramble') {
    if (frames.length > 4) throw new Error("control: 'scramble' doubles the frames — pass at most 4 (8 per look)");
    frames = frames.flatMap((f, i) => {
      const g = scrambleGrid(f.grid, 1000 + i);
      return [f, { ...f, id: `${f.id}s`, label: `${f.label ?? f.id} (scrambled twin)`, grid: g, measured: measure(g), twin_of: f.id, scrambled: true, expect: null }];
    });
  }
  const baselines = args.baseline ?? (args.legend === 'scene' || !!grids);
  const state = { legend: args.legend === 'scene' ? LEGEND_SCENE : LEGEND, frames: Object.fromEntries(frames.map(f => [f.id, {
    time: +f.t.toFixed(3), picture: Array.from({ length: N }, (_, r) => f.grid.slice(r * N, r * N + N).join(' ')) }])) };
  const questions = {};
  for (const f of frames) {
    const lead = `Look only at frame ${f.id} (time ${f.t.toFixed(2)}) in "frames". `;
    for (const p of presets) questions[`${f.id}_${p}`] = { ...PRESETS[p], instructions: lead + PRESETS[p].instructions };
    for (const [k, q] of Object.entries(custom)) questions[`${f.id}_${k}`] = { ...q, instructions: lead + q.instructions };
  }
  for (const [k, q] of Object.entries(compare)) questions[`all_${k}`] = { ...q, instructions: 'Look at all the frames in "frames". ' + q.instructions };
  // measured: Jev's tokenizer counted this JSON at ~2.5x the chars/4 guess
  const estTokens = Math.round(JSON.stringify({ state, questions }).length / 4 * 2.5);
  if (estTokens > STATE_TOKEN_CAP) throw new Error(`~${estTokens} tokens is over Jev's ~${STATE_TOKEN_CAP} limit — ask about fewer frames or fewer questions`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sheetPath = abs(args.out_path ?? 'bench/results/look/look.png');
  fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
  const png = sheetOf(frames); fs.writeFileSync(sheetPath, png);

  const base = {
    source: from, times: T.map(t => +t.toFixed(3)),
    window: images ? 'the whole picture' : grids ? 'your grid' : shots ? boxes.map(b => b.map(x => +x.toFixed(4))) : box.map(x => +x.toFixed(4)),
    framing: images ? `${images.length} picture(s) through the image door, legend: ${args.legend === 'scene' ? 'scene' : 'subject (a matte)'}`
      : grids ? `${grids.length} grid(s) through the grid door, legend: ${args.legend === 'scene' ? 'scene' : 'subject'}`
      : shots ? 'one camera window per shot (squared)' : args.window ? 'your window (squared)' : 'auto-fit to the subject — nothing can leave this frame; pass a window or shots to judge a real framing',
    sheet: sheetPath, est_tokens: estTokens, question_count: Object.keys(questions).length,
    palette: palName === 'kill_switch' ? undefined : `${palName} (${pal.length} words)`,
    control: args.control === 'scramble' ? 'scramble: each fN has a twin fNs with the same words shuffled — layout_effect = real − twin' : undefined,
    transport: tp.key ? tp.name : `${tp.name} (no key found)`,
    image: args.return_image ? { mimeType: 'image/png', base64: png.toString('base64') } : undefined,
  };
  const numOf = (a, pick) => (a == null ? null : a.probability ?? a.score ?? (pick != null ? a.probabilities?.[pick] : null) ?? null);
  const frameRows = (answers) => frames.map(f => {
    const row = { id: f.id, t: +f.t.toFixed(3), measured: args.legend === 'scene' ? undefined : f.measured, within_ceiling: f.within_ceiling ?? undefined };
    if (f.label) row.label = f.label;
    if (f.twin_of) row.twin_of = f.twin_of;
    if (baselines) row.baseline = baselineOf(f.grid);
    if (args.include_grid) row.grid = state.frames[f.id].picture;
    if (answers) {
      row.jev = {};
      for (const p of presets) {
        const a = answers[`${f.id}_${p}`]; if (!a) { row.jev[p] = { missing: true }; continue; }
        const val = a.choice ?? (a.probability != null ? a.probability >= 0.5 : a.score);
        const p_ = a.choice ? a.probabilities?.[a.choice] : a.probability;
        row.jev[p] = { answer: val, p: p_ != null ? +(+p_).toFixed(3) : undefined, measured: truthOf(p, f.measured), agrees: val === truthOf(p, f.measured) };
      }
      for (const k of Object.keys(custom)) {
        const a = answers[`${f.id}_${k}`];
        row.jev[k] = !a ? { missing: true } : { answer: a.choice ?? a.score ?? (a.probability != null ? a.probability >= 0.5 : null),
          p: a.probability ?? (a.choice ? a.probabilities?.[a.choice] : undefined), probabilities: a.probabilities, control: 'none — a judgement, not a measurement' };
        if (a && f.expect && k in f.expect) { row.jev[k].expected = f.expect[k]; row.jev[k].agrees = row.jev[k].answer === f.expect[k]; row.jev[k].control = 'expect (supplied by the caller — see their notes for how it was measured)'; }
      }
      // 👁 the scramble control: how much of each answer was the LAYOUT? (real − twin, on the real frame's row)
      if (args.control === 'scramble' && !f.twin_of) {
        row.layout_effect = {};
        for (const k of [...presets, ...Object.keys(custom)]) {
          const a = answers[`${f.id}_${k}`], b = answers[`${f.id}s_${k}`];
          const x = numOf(a, a?.choice), y = numOf(b, a?.choice);
          row.layout_effect[k] = x != null && y != null ? +(x - y).toFixed(3) : null;
        }
      }
    }
    return row;
  });

  if (args.dry_run) {
    return { ok: true, dry_run: true, ...base, frames: frameRows(null),
      note: 'Nothing was sent. These are the grids and the code\'s own measurements; a live call asks Jev the same questions about the same grids.' };
  }

  const key = tp.key;
  if (!key) return { ok: false, no_key: true, ...base, frames: frameRows(null),
    reason: 'no key found — looked for OPENROUTER_API_KEY, TYPESAFE_API_KEY and AI_GATEWAY_API_KEY in the environment, in GEO_JEV_ENV, and in ../jev-lab/.env.local — dry_run:true works without one' };

  // the Vercel body is byte for byte what it always was; the native routes get TypeSafe's own shape
  const body = route.native
    ? JSON.stringify({ ...(route.model() ? { model: route.model() } : {}), state, questions: toNative(questions) })
    : JSON.stringify({ model: MODEL, state, questions, providerOptions: { gateway: { order: ['typesafe-ai'] } } });
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (tp.name === 'openrouter') headers['x-title'] = 'geo-runtime geo_look';
  const waitMs = Math.max(0, Math.min(120, args.wait_s ?? 20)) * 1000;
  const t0 = Date.now(); let res, text_ = '', status = 0, tries = 0, after = null, wallMs = 0;
  do {
    tries++; const a0 = Date.now();
    try { res = await fetch(route.url(), { method: 'POST', headers, body }); status = res.status; text_ = await res.text(); after = retryAfterS(res.headers.get('retry-after')); }
    catch (e) { status = -1; text_ = String(e.cause?.code ?? e.message); }
    wallMs = Date.now() - a0;
    if (status === 200) break;
    if (status !== 429 && status < 500 && status !== -1) break;
    const pause = route.native && after != null ? after * 1000 : 5000;
    if (Date.now() - t0 + pause > waitMs) break;
    await sleep(pause);
  } while (true);

  const logRow = { at: new Date().toISOString(), source: from, status, tries, est_tokens: estTokens, questions: Object.keys(questions).length,
                   ...(tp.name !== 'vercel' ? { transport: tp.name } : {}) };
  if (status !== 200) {
    fs.appendFileSync(path.join(OUT_DIR, 'calls.jsonl'), JSON.stringify(logRow) + '\n');
    if (route.native) return { ok: false, ...base, frames: frameRows(null), status, tries, rate_limited: status === 429,
      reason: status === 429 ? `${tp.name} rate-limited this call` : status === 401 || status === 403 ? `${tp.name} refused the key (${status})` : `HTTP ${status}`,
      detail: text_.slice(0, 300), retry_in_s: status === 429 ? (after ?? 5) : undefined,
      note: 'The grids and measurements above are complete. Nothing is queued.' };
    const last = lastAnswer();
    const since = last ? Math.round((Date.now() - Date.parse(last.at)) / 1000) : null;
    return { ok: false, ...base, frames: frameRows(null), status, tries,
      rate_limited: status === 429,
      reason: status === 429 ? 'Jev is rate-limited — it answers this account about once every 5 minutes on the Vercel route (an OPENROUTER_API_KEY or TYPESAFE_API_KEY in ../jev-lab/.env.local switches to a route without that wall)'
        : status === 403 ? 'the AI Gateway refused the key (billing or permissions)' : `HTTP ${status}`,
      detail: status === 429 ? undefined : text_.slice(0, 300),
      last_answer_s_ago: since,
      retry_in_s: since != null ? Math.max(0, 310 - since) : 310,
      note: 'The grids and measurements above are complete. Call again after retry_in_s; nothing is queued.' };
  }

  const json = JSON.parse(text_);
  const answers = fromNative(json.answers ?? json.result?.answers ?? {});
  const rows = frameRows(answers);
  const checks = rows.flatMap(r => presets.map(p => r.jev[p])).filter(x => x && !x.missing);
  const agree = checks.filter(x => x.agrees).length;
  const gw = json.providerMetadata?.gateway ?? json.provider_metadata?.gateway ?? {};
  const pa = gw.routing?.modelAttempts?.[0]?.providerAttempts?.at(-1);
  const cost = json.usage?.cost ?? gw.cost;
  const compared = Object.keys(compare).length ? Object.fromEntries(Object.keys(compare).map(k => { const a = answers[`all_${k}`];
    return [k, !a ? { missing: true } : { answer: a.choice ?? a.score ?? (a.probability != null ? a.probability >= 0.5 : null),
      p: a.probability ?? (a.choice ? a.probabilities?.[a.choice] : undefined), probabilities: a.probabilities, control: 'none — a judgement across frames' }]; })) : undefined;
  const out = { ok: true, ...base, frames: rows, compare: compared,
    agreement: { with_measured: `${agree}/${checks.length}`, note: checks.length
      ? 'Presets are measured in code on the same grid — this is Jev calibrated against ground truth, on YOUR frames.' : 'no presets asked' },
    cost_usd: cost != null ? +cost : undefined, input_tokens: json.usage?.inputTokens ?? json.usage?.input_tokens,
    jev_ms: pa ? pa.endTime - pa.startTime : undefined, wall_ms: route.native ? wallMs : undefined, tries,
    next_answer_in_s: route.paced_s,
    note: route.native ? `Custom questions have no control — they are Jev's judgement. Route: ${tp.name} (no 5-minute pacing).`
      : 'Custom questions have no control — they are Jev\'s judgement. One call per ~5 minutes on this account.' };
  if (!route.native) fs.writeFileSync(lastPath, JSON.stringify({ at: logRow.at }));
  fs.appendFileSync(path.join(OUT_DIR, 'calls.jsonl'), JSON.stringify({ ...logRow, agree: out.agreement.with_measured, cost_usd: out.cost_usd }) + '\n');
  return out;
}

