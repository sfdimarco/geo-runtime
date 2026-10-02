// Experiment 01b: overshoot sweep.
//
// Recovery timing is fixed. ONE variable changes: how far past canonical
// roundness the subject travels before settling.
//
//   node experiments/stubborn-circle/overshoot-sweep.mjs
//
// Writes:
//   experiments/stubborn-circle/overshoot-sweep.png
//   experiments/stubborn-circle/overshoot-sweep.gif

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(HERE, 'target.geocast'), 'utf8'));

const RELEASE = 0.92;
const PEAK = 1.06;
const SETTLE = 1.20;
const OVERSHOOT = [0.00, 0.02, 0.05, 0.09, 0.14, 0.22];
const SAMPLE_DT = [0.04, 0.12, 0.20, 0.30];

// sy = 1 + amount. sx compensates in the two radial axes so approximate
// volume is preserved: sx^2 * sy = 1.
const makeDoc = (amount) => {
  const d = structuredClone(base);
  const sy = 1 + amount;
  const sx = 1 / Math.sqrt(sy);
  d.name = `stubborn-circle-overshoot-${amount.toFixed(2)}`;
  d.poses.proud = { body: { scale_x: sx, scale_y: sy } };
  d.plan = [
    { pose: 'round', t: 0.0 },
    { pose: 'squeezed', t: 0.72 },
    { pose: 'squeezed', t: RELEASE },
    { pose: 'proud', t: PEAK },
    { pose: 'round', t: SETTLE },
  ];
  return d;
};

const variants = [];
for (const amount of OVERSHOOT) {
  const { K, header } = await loadCast(makeDoc(amount));
  if (variants.length && header.maxVerts !== variants[0].header.maxVerts) {
    throw new Error('overshoot changed the vertex ceiling');
  }
  variants.push({ amount, K, header });
}

const BOX = [-0.31, 0.20, 0.31, 0.80];
const CW = 210, CH = 210, LABEL = 34;
const W = CW * OVERSHOOT.length;
const H = (CH + LABEL) * SAMPLE_DT.length;
const img = canvasOf(W, H);

for (let row = 0; row < SAMPLE_DT.length; row++) {
  const t = RELEASE + SAMPLE_DT[row];
  for (let col = 0; col < variants.length; col++) {
    const { amount, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at overshoot=${amount}, t=${t}`);
    const ox = col * CW, oy = row * (CH + LABEL);
    drawCel(img, W, ox, oy, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(img, W, `O ${amount.toFixed(2)}`, ox + 12, oy + CH + 5, 2);
    text(img, W, `+${SAMPLE_DT[row].toFixed(2)}S`, ox + 114, oy + CH + 5, 2);
  }
}

const out = path.join(HERE, 'overshoot-sweep.png');
fs.writeFileSync(out, encodePNG(img, W, H));

// Animated comparison: same clock, one loop through the event.
const GW = W, GH = CH + LABEL;
const fps = 20;
const t0 = 0.68, t1 = 1.42;
const n = Math.ceil((t1 - t0) * fps);
const gifFrames = [];
for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const frame = canvasOf(GW, GH);
  for (let col = 0; col < variants.length; col++) {
    const { amount, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at overshoot=${amount}, t=${t}`);
    const ox = col * CW;
    drawCel(frame, GW, ox, 0, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(frame, GW, `O ${amount.toFixed(2)}`, ox + 30, CH + 5, 2);
  }
  gifFrames.push(frame);
}
const gifOut = path.join(HERE, 'overshoot-sweep.gif');
fs.writeFileSync(gifOut, encodeGIF(gifFrames, GW, GH, {
  delay: Math.round(100 / fps),
  loop: 0
}));

console.log(JSON.stringify({
  out,
  gif: gifOut,
  axis: 'overshoot',
  values: OVERSHOOT,
  peak_time: PEAK,
  settle_time: SETTLE,
  ceiling: variants[0].header.maxVerts,
  gif_frames: gifFrames.length,
  gif_fps: fps
}, null, 2));
