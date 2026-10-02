// Experiment 01c: the afterthought.
//
// Question: when does an elastic overshoot stop reading as material physics and
// start reading as a decision?
//
// Recovery and overshoot amount are fixed. ONE variable changes: the pause at
// canonical roundness before the little "hmph" stretch.
//
//   node experiments/stubborn-circle/afterthought-sweep.mjs
//
// Writes:
//   experiments/stubborn-circle/afterthought-sweep.png
//   experiments/stubborn-circle/afterthought-sweep.gif

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(HERE, 'target.geocast'), 'utf8'));

const RELEASE = 0.92;
const ROUND_AT = 1.06;             // 0.14s recovery: the interesting band from 01a
const PROUD_AMOUNT = 0.09;         // visible but not yet grotesque in 01b
const PROUD_RISE = 0.10;
const SETTLE = 0.13;
const PAUSE = [0.00, 0.04, 0.08, 0.14, 0.22, 0.36];

// Approximate volume preservation: sx^2 * sy = 1.
const sy = 1 + PROUD_AMOUNT;
const sx = 1 / Math.sqrt(sy);

const makeDoc = (pause) => {
  const d = structuredClone(base);
  d.name = `stubborn-circle-afterthought-${pause.toFixed(2)}`;
  d.poses.proud = { body: { scale_x: sx, scale_y: sy } };
  const proudAt = ROUND_AT + pause + PROUD_RISE;
  d.plan = [
    { pose: 'round', t: 0.0 },
    { pose: 'squeezed', t: 0.72 },
    { pose: 'squeezed', t: RELEASE },
    { pose: 'round', t: ROUND_AT },
    // Two round beats make the pause explicit instead of hiding it in easing.
    { pose: 'round', t: ROUND_AT + pause },
    { pose: 'proud', t: proudAt },
    { pose: 'round', t: proudAt + SETTLE },
  ];
  return d;
};

const variants = [];
for (const pause of PAUSE) {
  const { K, header } = await loadCast(makeDoc(pause));
  if (variants.length && header.maxVerts !== variants[0].header.maxVerts) {
    throw new Error('afterthought changed the vertex ceiling');
  }
  variants.push({ pause, K, header });
}

const BOX = [-0.31, 0.20, 0.31, 0.80];
const CW = 210, CH = 210, LABEL = 34;
const W = CW * PAUSE.length;

// Still sheet samples the same GLOBAL moments. This is intentionally not
// phase-normalised: the entire question is what a pause does to perceived time.
const TIMES = [0.98, 1.06, 1.14, 1.24, 1.38, 1.54];
const H = (CH + LABEL) * TIMES.length;
const img = canvasOf(W, H);

for (let row = 0; row < TIMES.length; row++) {
  const t = TIMES[row];
  for (let col = 0; col < variants.length; col++) {
    const { pause, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at pause=${pause}, t=${t}`);
    const ox = col * CW, oy = row * (CH + LABEL);
    drawCel(img, W, ox, oy, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(img, W, `P ${pause.toFixed(2)}S`, ox + 12, oy + CH + 5, 2);
    text(img, W, `T ${t.toFixed(2)}`, ox + 112, oy + CH + 5, 2);
  }
}

const out = path.join(HERE, 'afterthought-sweep.png');
fs.writeFileSync(out, encodePNG(img, W, H));

// Animated strip. Same global clock for every variant.
const GW = W, GH = CH + LABEL;
const fps = 20;
const t0 = 0.68, t1 = 1.78;
const n = Math.ceil((t1 - t0) * fps);
const gifFrames = [];
for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const frame = canvasOf(GW, GH);
  for (let col = 0; col < variants.length; col++) {
    const { pause, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at pause=${pause}, t=${t}`);
    const ox = col * CW;
    drawCel(frame, GW, ox, 0, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(frame, GW, `PAUSE ${pause.toFixed(2)}`, ox + 14, CH + 5, 2);
  }
  gifFrames.push(frame);
}
const gifOut = path.join(HERE, 'afterthought-sweep.gif');
fs.writeFileSync(gifOut, encodeGIF(gifFrames, GW, GH, {
  delay: Math.round(100 / fps),
  loop: 0
}));

console.log(JSON.stringify({
  out,
  gif: gifOut,
  axis: 'pause_before_proud_overshoot_seconds',
  values: PAUSE,
  recovery_seconds: ROUND_AT - RELEASE,
  proud_amount: PROUD_AMOUNT,
  ceiling: variants[0].header.maxVerts,
  gif_frames: gifFrames.length,
  gif_fps: fps
}, null, 2));
