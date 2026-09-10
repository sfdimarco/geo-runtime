// tools/render.mjs — a software renderer for .geo, in pure Node.
//
// WHY THIS EXISTS: geo_compile / geo_build / geo_validate / geo_bench all return
// NUMBERS. Nothing could see. A wide contact sheet told us "the legs never move";
// a windowed render of the same program showed a leg lifting and its boot staying
// behind. The picture is not decoration — it is the check the numbers cannot make.
//
// It needs NO browser, NO GPU and NO dependencies: a z-buffer scanline rasteriser
// over the arena's own vertex view, and a PNG written straight through zlib.
//
//   node tools/render.mjs                        # the reference character, 8 frames
//   node tools/render.mjs my.geocast --times 0,0.7,1.4 --out shot.png
//   node tools/render.mjs my.geocast --window -0.26,-0.02,0.26,0.44   # crop, mesh coords
//   node tools/render.mjs my.geocast --gif --fps 10 --out walk.gif    # MOTION
//
// ⭐ --gif draws ONE LOOP OF THE PLAN as an animated GIF instead of a contact
//   sheet. A sheet shows you eight moments; it does not show you a foot leaving
//   a leg. Same rule as everything else here: no dependencies — see tools/gif.mjs.
//
// ⚠ MESH Y IS INVERTED RELATIVE TO THE CAST: y_mesh = 1 - y_cast. --window takes
//   MESH coordinates. Getting this backwards renders the head when you asked for feet.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadCast, loadKernel, ROOT } from '../bench/kernel.mjs';
import { encodeGIF } from './gif.mjs';

const LIGHT = (() => { const v = [-0.42, 0.66, 0.62], n = Math.hypot(...v); return v.map(x => x / n); })();
export const BG = [22, 25, 30];

/** A cleared image. RGB, no alpha — nothing here has ever needed one. */
export const canvasOf = (w, h, bg = BG) => {
  const a = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { a[i*3] = bg[0]; a[i*3+1] = bg[1]; a[i*3+2] = bg[2]; }
  return a;
};

// ── a 5x7 bitmap font, because A LABEL THAT IS NOT IN THE FRAME IS NOT A LABEL ─
// ⭐ THE TINKER LOOP'S THIRD RULE: labels that show only what VARIES. A contact
//   sheet you have to cross-reference against a caption is a contact sheet you
//   read slowly, and reading it fast is the entire point.
//   Packed 8 chars per glyph: the character, then 7 rows base-32, 5 bits each.
const B32 = '0123456789ABCDEFGHIJKLMNOPQRSTUV';
const FONT_SRC = '0EHJLPHE14C4444E2EH1248V3V2421HE426AIV225VGU11HE668GUHHE7V1248888EHHEHHE9EHHF12CAEHHVHHHBUHHUHHUCEHGGGHEDSIHHHISEVGGUGGVFVGGUGGGGEHGNHHFHHHHVHHHIE44444EJ72222ICKHIKOKIHLGGGGGGVMHRLLHHHNHHPLJHHOEHHHHHEPUHHUGGGQEHHHLIDRUHHUKIHSFGGE11UTV444444UHHHHHHEVHHHHHA4WHHHLLRHXHHA4AHHYHHA4444ZV1248GV.00000CC-000V000=00V0V00_000000V+044V440/122488G:0CC0CC0 0000000';
export const FONT = (() => {
  const m = new Map();
  for (let i = 0; i < FONT_SRC.length; i += 8) m.set(FONT_SRC[i], FONT_SRC.slice(i + 1, i + 8));
  return m;
})();

/** Draw `str` at (x0,y0) in `px`, scale `k`. Unknown characters render blank. */
export function text(px, W, str, x0, y0, k = 2, col = [214, 218, 228]) {
  let x = x0;
  for (const ch of String(str).toUpperCase()) {
    const g = FONT.get(ch) ?? FONT.get(' ');
    for (let r = 0; r < 7; r++) {
      const bits = B32.indexOf(g[r]);
      for (let c = 0; c < 5; c++) {
        if (!((bits >> (4 - c)) & 1)) continue;
        for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
          const q = ((y0 + r * k + dy) * W + x + c * k + dx) * 3;
          if (q < 0 || q + 2 >= px.length) continue;
          px[q] = col[0]; px[q+1] = col[1]; px[q+2] = col[2];
        }
      }
    }
    x += 6 * k;
  }
  return x - x0;
}
export const textWidth = (str, k = 2) => String(str).length * 6 * k;

/**
 * Rasterise ONE built mesh into a CW x CH cel at (ox,oy) inside `dst`.
 * ⚠ This is the ONLY rasteriser in the repo, on purpose: a sweep that renders
 *   through a different path tells you about the sweep, not about what ships.
 */
export function drawCel(dst, DW, ox, oy, CW, CH, m, ix, stride, box) {
  const [X0, Y0, X1, Y1] = box;
  const sxy = (x, y) => [(x - X0) / (X1 - X0) * CW, CH * (1 - (y - Y0) / (Y1 - Y0))];
  const zb = new Float32Array(CW * CH).fill(-1e30);
  for (let i = 0; i + 2 < ix.length; i += 3) {
    const T3 = [ix[i], ix[i+1], ix[i+2]];
    const p = T3.map(v => { const [sx, sy] = sxy(m[v*stride], m[v*stride+1]); return [sx, sy, m[v*stride+2]]; });
    const ar = (p[1][0]-p[0][0])*(p[2][1]-p[0][1]) - (p[2][0]-p[0][0])*(p[1][1]-p[0][1]);
    if (ar === 0) continue;
    let n = [0, 0, 0];
    for (const v of T3) { const o = v*stride+5; n[0]+=m[o]; n[1]+=m[o+1]; n[2]+=m[o+2]; }
    const nl = Math.hypot(...n) || 1; n = n.map(c => c / nl);
    const lam = Math.abs(n[0]*LIGHT[0] + n[1]*LIGHT[1] + n[2]*LIGHT[2]);   // two-sided
    const rim = Math.pow(1 - Math.min(1, Math.abs(n[2])), 3) * 0.30;
    const s = Math.min(255, (0.30 + 0.82*lam + rim) * 214) | 0;
    const mnx = Math.max(0, Math.floor(Math.min(p[0][0],p[1][0],p[2][0]))), mxx = Math.min(CW-1, Math.ceil(Math.max(p[0][0],p[1][0],p[2][0])));
    const mny = Math.max(0, Math.floor(Math.min(p[0][1],p[1][1],p[2][1]))), mxy = Math.min(CH-1, Math.ceil(Math.max(p[0][1],p[1][1],p[2][1])));
    for (let y = mny; y <= mxy; y++) for (let x = mnx; x <= mxx; x++) {
      const w0 = ((p[1][0]-p[0][0])*(y+0.5-p[0][1]) - (x+0.5-p[0][0])*(p[1][1]-p[0][1])) / ar;
      const w1 = ((x+0.5-p[0][0])*(p[2][1]-p[0][1]) - (p[2][0]-p[0][0])*(y+0.5-p[0][1])) / ar;
      if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
      const z = p[0][2] + w1*(p[1][2]-p[0][2]) + w0*(p[2][2]-p[0][2]);
      const zi = y*CW + x; if (z <= zb[zi]) continue; zb[zi] = z;
      const q = ((oy+y)*DW + ox+x)*3; dst[q] = s; dst[q+1] = (s*0.99)|0; dst[q+2] = (s*0.95)|0;
    }
  }
}

/** Where this frame sits in the plan. */
export function planBarInto(dst, DW, ox, oy, CW, CH, t, planEnd) {
  if (!(planEnd > 0)) return;
  const bw = CW - 48, fill = Math.round(bw * (t / planEnd));
  for (let x = 0; x < bw; x++) for (let y = 0; y < 5; y++) {
    const q = ((oy + CH - 18 + y)*DW + ox + 24 + x)*3; const on = x < fill;
    dst[q] = on?230:58; dst[q+1] = on?80:62; dst[q+2] = on?70:70;
  }
}
export function celBorder(dst, DW, ox, oy, CH, col = [44, 48, 56]) {
  for (let y = 0; y < CH; y++) { const q = ((oy+y)*DW + ox)*3; dst[q]=col[0]; dst[q+1]=col[1]; dst[q+2]=col[2]; }
}

/** One shared box across every time, so a frame cannot silently rescale. */
export function boundsOf(K, T, pad = 0.08) {
  let lo = [1e30, 1e30], hi = [-1e30, -1e30];
  for (const t of T) { const b = K.build(t), m = K.meshView();
    for (let v = 0; v < b.verts; v++) for (let a = 0; a < 2; a++) {
      const x = m[v * b.stride + a]; if (x < lo[a]) lo[a] = x; if (x > hi[a]) hi[a] = x; } }
  const d = pad * Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  return [lo[0] - d, lo[1] - d, hi[0] + d, hi[1] + d];
}

export function encodePNG(rgb, W, H) {
  const T = (() => { const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
    return t; })();
  const crc = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) { raw[y * (1 + W * 3)] = 0; Buffer.from(rgb.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Render one or more plan times of a .geo program to a PNG contact sheet.
 * Returns a SUMMARY, never a buffer — same rule as the MCP tools.
 */
export async function render({
  doc, castPath, geoPath, res,
  times = null, out = 'render.png',
  cell = [300, 400], cols = 4, window: win = null, bg = [22, 25, 30], plan_bar = true,
  gif = false, fps = 10,
} = {}) {
  let K, header;
  if (geoPath) { K = await loadKernel(); header = K.load(new Uint8Array(fs.readFileSync(geoPath))); }
  else {
    const d = doc ?? JSON.parse(fs.readFileSync(castPath ?? path.join(ROOT, 'bench/reference/v36-test-character.geocast'), 'utf8'));
    ({ K, header } = await loadCast(d, { res }));
  }
  const planEnd = header.planEnd ?? 1;
  // ⚠ a GIF LOOPS, so the last frame must not repeat the first: the sheet
  //   samples i/(n-1) INCLUSIVE of the end, an animation samples i/n EXCLUSIVE.
  //   Getting this wrong shows up as a one-frame stutter at the seam.
  const N = gif ? Math.max(2, Math.round(planEnd * fps)) : 8;
  const T = times ?? Array.from({ length: N },
    (_, i) => (gif ? i / N : i / (N - 1)) * planEnd);
  const [CW, CH] = cell;

  const box = win ?? boundsOf(K, T);
  const [X0, Y0, X1, Y1] = box;

  // a sheet writes every frame into ONE image at an offset; an animation gives
  // each frame its own. One rasteriser, two targets.
  const canvas = (w, h) => canvasOf(w, h, bg);
  const ROWS = gif ? 1 : Math.ceil(T.length / cols);
  const W = gif ? CW : Math.min(cols, T.length) * CW, H = gif ? CH : ROWS * CH;
  const sheet = gif ? null : canvas(W, H);
  const cels = [];
  const frames = [];

  for (let f = 0; f < T.length; f++) {
    const t = T[f], b = K.build(t), m = K.meshView(), ix = K.idxView();
    frames.push({ t, verts: b.verts, idx: b.idx, within_ceiling: b.verts <= header.maxVerts, overflow: b.overflow });
    const img = gif ? canvas(CW, CH) : sheet;
    const DW = gif ? CW : W;
    const ox = gif ? 0 : (f % cols) * CW, oy = gif ? 0 : Math.floor(f / cols) * CH;
    drawCel(img, DW, ox, oy, CW, CH, m, ix, b.stride, box);
    if (plan_bar) planBarInto(img, DW, ox, oy, CW, CH, t, planEnd);
    celBorder(img, DW, ox, oy, CH);
    if (gif) cels.push(img);
  }
  const delay = Math.max(2, Math.round(100 / fps));
  const buf = gif ? encodeGIF(cels, CW, CH, { delay, loop: 0 }) : encodePNG(sheet, W, H);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, buf);
  return { out: path.resolve(out), format: gif ? 'gif' : 'png',
           width: W, height: H, bytes: buf.length,
           fps: gif ? fps : undefined, delay_cs: gif ? delay : undefined,
           palette_exact: gif ? !!buf.paletteExact : undefined,
           ceiling: header.maxVerts, window: [X0, Y0, X1, Y1], frames };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const flag = (n) => { const i = a.indexOf('--'+n); return i < 0 ? null : a[i+1]; };
  const castPath = a[0] && !a[0].startsWith('--') ? a[0] : null;
  const nums = (s) => s.split(',').map(Number);
  const wantGif = a.includes('--gif');
  const r = await render({
    castPath, gif: wantGif, fps: flag('fps') ? +flag('fps') : 10,
    out: flag('out') ?? (wantGif ? 'render.gif' : 'render.png'),
    times: flag('times') ? nums(flag('times')) : null,
    window: flag('window') ? nums(flag('window')) : null,
    cols: flag('cols') ? +flag('cols') : 4,
    cell: flag('cell') ? nums(flag('cell')) : [300, 400],
  });
  console.log(`${r.out}  ${r.width}x${r.height}  ${(r.bytes/1024).toFixed(0)} KB` +
              (r.format === 'gif' ? `  ${r.frames.length} frames @ ${r.fps} fps` +
               (r.palette_exact ? '  palette lossless' : '  palette quantised') : ''));
  console.log(`ceiling ${r.ceiling} verts · frames ` + r.frames.map(f => f.t.toFixed(2)).join(' '));
  const bad = r.frames.filter(f => !f.within_ceiling || f.overflow);
  console.log(bad.length ? `!! ${bad.length} frame(s) breached the ceiling` : 'every frame inside the ceiling, 0 overflow');
}
