// ═══════════════════════════════════════════════════════════════════════════
// tools/gif.mjs — an animated GIF, in pure Node. No dependencies.
//
// WHY: `geo_render` could draw a frame. It could not draw MOTION, and motion is
// the only thing this runtime is for. A contact sheet shows you eight moments;
// it does not show you a foot leaving a leg. The same rule as the PNG encoder
// beside it — if the proof needs a library nobody has, it is not a proof.
//
//   GIF89a · one global palette · LZW · Netscape 2.0 loop block.
//
// ⚠ 256 COLOURS IS THE FORMAT, NOT A SHORTCUT. The palette is built from the
//   frames themselves — the 256 most common exact colours — and anything else
//   maps to its nearest neighbour, cached, so each distinct colour is searched
//   once. The software renderer emits a shading ramp plus a handful of chrome
//   colours, so this is normally LOSSLESS.
// ═══════════════════════════════════════════════════════════════════════════

/** Build a ≤256-entry palette from every frame, and an exact index map. */
function palettise(frames, W, H) {
  const hist = new Map();
  for (const f of frames) {
    for (let i = 0; i < W * H; i++) {
      const k = (f[i * 3] << 16) | (f[i * 3 + 1] << 8) | f[i * 3 + 2];
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  const pal = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map((e) => e[0]);
  const index = new Map(pal.map((c, i) => [c, i]));
  // anything that did not make the cut resolves to its nearest neighbour, ONCE
  const nearest = (k) => {
    const r = k >> 16, g = (k >> 8) & 255, b = k & 255;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const p = pal[i];
      const dr = r - (p >> 16), dg = g - ((p >> 8) & 255), db = b - (p & 255);
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const at = (k) => {
    let i = index.get(k);
    if (i === undefined) { i = nearest(k); index.set(k, i); }
    return i;
  };
  return { pal, at, exact: hist.size <= 256 };
}

/** GIF's LZW, sub-blocked. Ported from the canonical encoder shape. */
function lzw(indices, minCodeSize) {
  const out = [];
  const clear = 1 << minCodeSize;
  const mask = clear - 1;
  const eoi = clear + 1;
  let next = eoi + 1;
  let size = minCodeSize + 1;

  let cur = 0, shift = 0;
  const flush = () => { while (shift >= 8) { out.push(cur & 0xFF); cur >>= 8; shift -= 8; } };
  const emit = (c) => { cur |= c << shift; shift += size; flush(); };

  emit(clear);
  let table = new Map();
  let ib = indices[0] & mask;
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i] & mask;
    const key = (ib << 8) | k;
    const got = table.get(key);
    if (got === undefined) {
      emit(ib);
      if (next === 4096) {
        emit(clear);
        next = eoi + 1;
        size = minCodeSize + 1;
        table = new Map();
      } else {
        // ⚠ the width grows BEFORE the new code is handed out, or the decoder
        //   and the encoder disagree by exactly one code and the whole stream
        //   decodes to noise from that byte on
        if (next >= (1 << size)) size++;
        table.set(key, next++);
      }
      ib = k;
    } else ib = got;
  }
  emit(ib);
  emit(eoi);
  while (shift > 0) { out.push(cur & 0xFF); cur >>= 8; shift -= 8; }

  const blocks = [];
  for (let i = 0; i < out.length; i += 255) {
    const chunk = out.slice(i, i + 255);
    blocks.push(chunk.length, ...chunk);
  }
  blocks.push(0);
  return Buffer.from(blocks);
}

/**
 * @param {Uint8Array[]} frames  RGB, W*H*3 each, in order
 * @param {number} W @param {number} H
 * @param {{delay?: number, loop?: number}} opts  delay in HUNDREDTHS of a second
 * @returns {Buffer}
 */
export function encodeGIF(frames, W, H, { delay = 8, loop = 0 } = {}) {
  if (!frames.length) throw new Error('encodeGIF: no frames');
  const { pal, at, exact } = palettise(frames, W, H);
  // the global colour table must be a power of two
  let bits = 1;
  while ((1 << bits) < pal.length) bits++;
  const tableLen = 1 << bits;

  const parts = [];
  parts.push(Buffer.from('GIF89a', 'ascii'));

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(W, 0);
  lsd.writeUInt16LE(H, 2);
  lsd[4] = 0x80 | (bits - 1);        // global table present, `bits` per entry
  lsd[5] = 0;                        // background index
  lsd[6] = 0;                        // no pixel aspect ratio
  parts.push(lsd);

  const gct = Buffer.alloc(tableLen * 3);
  pal.forEach((c, i) => { gct[i * 3] = c >> 16; gct[i * 3 + 1] = (c >> 8) & 255; gct[i * 3 + 2] = c & 255; });
  parts.push(gct);

  // NETSCAPE2.0 — the only reason a GIF loops
  parts.push(Buffer.from([0x21, 0xFF, 0x0B]), Buffer.from('NETSCAPE2.0', 'ascii'),
             Buffer.from([0x03, 0x01, loop & 0xFF, (loop >> 8) & 0xFF, 0x00]));

  const minCodeSize = Math.max(2, bits);
  for (const f of frames) {
    const gce = Buffer.alloc(8);
    gce[0] = 0x21; gce[1] = 0xF9; gce[2] = 0x04;
    gce[3] = 0x04;                   // disposal 1 (do not dispose) — every
                                     // frame is full-size and opaque, so it overwrites
    gce.writeUInt16LE(delay, 4);
    gce[6] = 0;                      // no transparent index
    gce[7] = 0;
    parts.push(gce);

    const id = Buffer.alloc(10);
    id[0] = 0x2C;
    id.writeUInt16LE(0, 1); id.writeUInt16LE(0, 3);
    id.writeUInt16LE(W, 5); id.writeUInt16LE(H, 7);
    id[9] = 0;                       // no local table, not interlaced
    parts.push(id);

    const idx = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      idx[i] = at((f[i * 3] << 16) | (f[i * 3 + 1] << 8) | f[i * 3 + 2]);
    }
    parts.push(Buffer.from([minCodeSize]), lzw(idx, minCodeSize));
  }

  parts.push(Buffer.from([0x3B]));
  const buf = Buffer.concat(parts);
  buf.paletteExact = exact;
  return buf;
}

export default encodeGIF;
