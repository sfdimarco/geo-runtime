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
const OUT_DIR = path.join(ROOT, 'bench/results/look');

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
const PAL = Object.fromEntries(PALETTE);
function nearestName([r, g, b]) {
  let best = null, bd = Infinity;
  for (const [n, [R2, G2, B2]] of PALETTE) {
    const rm = (r + R2) / 2, dr = r - R2, dg = g - G2, db = b - B2;
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
function gridOf(root) {
  const g = new Array(N * N);
  for (const n of leavesAt(root, D)) {
    const nm = nearestName(yccToRgb(n.c)), c0 = n.x / CELL, r0 = n.y / CELL, sz = n.s / CELL;
    for (let r = r0; r < r0 + sz; r++) for (let c = c0; c < c0 + sz; c++) g[r * N + c] = nm;
  }
  return g;
}
const BG_WORD = nearestName(BG);   // what the renderer's empty background reads as
const LEGEND = `Each frame is a ${N} x ${N} grid of cells. picture[0] is the top row and picture[${N - 1}] is the bottom row. ` +
  `In each row the first word is the left edge and the last word is the right edge. Each word is the colour of one cell. ` +
  `${BG_WORD} cells are empty background; every cell that is not ${BG_WORD} is part of the subject.`;

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

function readKey() {
  if (process.env.AI_GATEWAY_API_KEY) return process.env.AI_GATEWAY_API_KEY.trim();
  const files = [process.env.GEO_JEV_ENV, path.join(ROOT, '..', 'jev-lab', '.env.local')].filter(Boolean);
  for (const f of files) {
    try { const k = (fs.readFileSync(f, 'utf8').match(/^AI_GATEWAY_API_KEY=["']?([^"'\r\n]+)/m) || [])[1]; if (k) return k.trim(); } catch { /* next */ }
  }
  return null;
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
      img[d] = f.px[s]; img[d+1] = f.px[s+1]; img[d+2] = f.px[s+2];
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

  // the program: a compiled .geo, or a cast compiled here — the same two doors as geo_render
  let K, header, from;
  if (args.geo_path) { K = await loadKernel(); header = K.load(new Uint8Array(fs.readFileSync(abs(args.geo_path)))); from = abs(args.geo_path); }
  else { const c = readCast(args); ({ K, header } = await loadCast(c.doc, { res: args.res })); from = c.from; }
  const planEnd = header.planEnd ?? 1;
  const nT = Math.max(1, Math.min(8, args.frames ?? 4));
  // SHOTS: one camera window per frame (a storyboard). Otherwise one shared box for every frame.
  const shots = args.shots ?? null;
  if (shots && (shots.length < 1 || shots.length > 8)) throw new Error('1 to 8 shots per look');
  if (shots && (args.window || args.times)) throw new Error('pass shots OR times/window, not both');
  const T = shots ? shots.map(s => s.t ?? 0)
    : args.times ?? Array.from({ length: nT }, (_, i) => (nT === 1 ? 0 : i / (nT - 1)) * planEnd);
  if (T.length > 8) throw new Error('at most 8 times per look — one call is one Jev answer, and bigger states read worse');

  // every box is SQUARED about its centre, so nothing is stretched
  const square = (b) => { const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, h = Math.max(b[2] - b[0], b[3] - b[1]) / 2; return [cx - h, cy - h, cx + h, cy + h]; };
  const shared = shots ? null : square(args.window ?? boundsOf(K, T));
  const boxes = shots ? shots.map(s => square(s.window)) : T.map(() => shared);
  const box = shared ?? boxes[0];

  const frames = T.map((t, i) => {
    const b = K.build(t), m = K.meshView(), ix = K.idxView();
    const px = canvasOf(W, W);
    drawCel(px, W, 0, 0, W, W, m, ix, b.stride, boxes[i]);
    const grid = gridOf(buildTree(px));
    return { id: `f${i}`, t, px, grid, measured: measure(grid), verts: b.verts, within_ceiling: b.verts <= header.maxVerts };
  });

  const state = { legend: LEGEND, frames: Object.fromEntries(frames.map(f => [f.id, {
    time: +f.t.toFixed(3), picture: Array.from({ length: N }, (_, r) => f.grid.slice(r * N, r * N + N).join(' ')) }])) };
  const questions = {};
  for (const f of frames) {
    const lead = `Look only at frame ${f.id} (time ${f.t.toFixed(2)}) in "frames". `;
    for (const p of presets) questions[`${f.id}_${p}`] = { ...PRESETS[p], instructions: lead + PRESETS[p].instructions };
    for (const [k, q] of Object.entries(custom)) questions[`${f.id}_${k}`] = { ...q, instructions: lead + q.instructions };
  }
  // measured: Jev's tokenizer counted this JSON at ~2.5x the chars/4 guess
  const estTokens = Math.round(JSON.stringify({ state, questions }).length / 4 * 2.5);
  if (estTokens > STATE_TOKEN_CAP) throw new Error(`~${estTokens} tokens is over Jev's ~${STATE_TOKEN_CAP} limit — ask about fewer frames or fewer questions`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sheetPath = abs(args.out_path ?? 'bench/results/look/look.png');
  fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
  const png = sheetOf(frames); fs.writeFileSync(sheetPath, png);

  const base = {
    source: from, times: T.map(t => +t.toFixed(3)),
    window: shots ? boxes.map(b => b.map(x => +x.toFixed(4))) : box.map(x => +x.toFixed(4)),
    framing: shots ? 'one camera window per shot (squared)' : args.window ? 'your window (squared)' : 'auto-fit to the subject — nothing can leave this frame; pass a window or shots to judge a real framing',
    sheet: sheetPath, est_tokens: estTokens, question_count: Object.keys(questions).length,
    image: args.return_image ? { mimeType: 'image/png', base64: png.toString('base64') } : undefined,
  };
  const frameRows = (answers) => frames.map(f => {
    const row = { id: f.id, t: +f.t.toFixed(3), measured: f.measured, within_ceiling: f.within_ceiling };
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
      }
    }
    return row;
  });

  if (args.dry_run) {
    return { ok: true, dry_run: true, ...base, frames: frameRows(null),
      note: 'Nothing was sent. These are the grids and the code\'s own measurements; a live call asks Jev the same questions about the same grids.' };
  }

  const key = readKey();
  if (!key) return { ok: false, no_key: true, ...base, frames: frameRows(null),
    reason: 'no AI_GATEWAY_API_KEY in the environment, in GEO_JEV_ENV, or in ../jev-lab/.env.local — dry_run:true works without one' };

  const body = JSON.stringify({ model: MODEL, state, questions, providerOptions: { gateway: { order: ['typesafe-ai'] } } });
  const waitMs = Math.max(0, Math.min(120, args.wait_s ?? 20)) * 1000;
  const t0 = Date.now(); let res, text_ = '', status = 0, tries = 0;
  do {
    tries++;
    try { res = await fetch(ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body }); status = res.status; text_ = await res.text(); }
    catch (e) { status = -1; text_ = String(e.cause?.code ?? e.message); }
    if (status === 200) break;
    if (status !== 429 && status < 500 && status !== -1) break;
    if (Date.now() - t0 + 5000 > waitMs) break;
    await sleep(5000);
  } while (true);

  const logRow = { at: new Date().toISOString(), source: from, status, tries, est_tokens: estTokens, questions: Object.keys(questions).length };
  if (status !== 200) {
    fs.appendFileSync(path.join(OUT_DIR, 'calls.jsonl'), JSON.stringify(logRow) + '\n');
    const last = lastAnswer();
    const since = last ? Math.round((Date.now() - Date.parse(last.at)) / 1000) : null;
    return { ok: false, ...base, frames: frameRows(null), status, tries,
      rate_limited: status === 429,
      reason: status === 429 ? 'Jev is rate-limited — it answers this account about once every 5 minutes'
        : status === 403 ? 'the AI Gateway refused the key (billing or permissions)' : `HTTP ${status}`,
      detail: status === 429 ? undefined : text_.slice(0, 300),
      last_answer_s_ago: since,
      retry_in_s: since != null ? Math.max(0, 310 - since) : 310,
      note: 'The grids and measurements above are complete. Call again after retry_in_s; nothing is queued.' };
  }

  const json = JSON.parse(text_);
  const answers = json.answers ?? json.result?.answers ?? {};
  const rows = frameRows(answers);
  const checks = rows.flatMap(r => presets.map(p => r.jev[p])).filter(x => x && !x.missing);
  const agree = checks.filter(x => x.agrees).length;
  const gw = json.providerMetadata?.gateway ?? {};
  const pa = gw.routing?.modelAttempts?.[0]?.providerAttempts?.at(-1);
  const out = { ok: true, ...base, frames: rows,
    agreement: { with_measured: `${agree}/${checks.length}`, note: checks.length
      ? 'Presets are measured in code on the same grid — this is Jev calibrated against ground truth, on YOUR frames.' : 'no presets asked' },
    cost_usd: gw.cost != null ? +gw.cost : undefined, input_tokens: json.usage?.inputTokens,
    jev_ms: pa ? pa.endTime - pa.startTime : undefined, tries,
    next_answer_in_s: 310,
    note: 'Custom questions have no control — they are Jev\'s judgement. One call per ~5 minutes on this account.' };
  fs.writeFileSync(lastPath, JSON.stringify({ at: logRow.at }));
  fs.appendFileSync(path.join(OUT_DIR, 'calls.jsonl'), JSON.stringify({ ...logRow, agree: out.agreement.with_measured, cost_usd: out.cost_usd }) + '\n');
  return out;
}
