// Experiment 01: recovery-time sweep.
//
// One variable changes: how long the subject takes to return from squeezed to
// canonical roundness. Everything else, including the release time, camera,
// deformation amount, and sample times, is fixed.
//
//   node experiments/stubborn-circle/sweep.mjs
//
// Writes experiments/stubborn-circle/recovery-sweep.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(HERE, 'target.geocast'), 'utf8'));
const RECOVERY = [0.04, 0.08, 0.14, 0.22, 0.36, 0.55];
const RELEASE = 0.92;
const SAMPLE_DT = [0.02, 0.08, 0.16, 0.28];

const makeDoc = (seconds) => {
  const d = structuredClone(base);
  d.name = `stubborn-circle-recovery-${seconds.toFixed(2)}`;
  d.plan = [
    { pose: 'round', t: 0.0 },
    { pose: 'squeezed', t: 0.72 },
    { pose: 'squeezed', t: RELEASE },
    { pose: 'round', t: RELEASE + seconds },
  ];
  return d;
};

const variants = [];
for (const seconds of RECOVERY) {
  const { K, header } = await loadCast(makeDoc(seconds));
  if (header.maxVerts !== variants[0]?.header.maxVerts && variants.length) {
    throw new Error('solid deformation changed the vertex ceiling');
  }
  variants.push({ seconds, K, header });
}

// Shared world window. The canonical circle is x ±0.2, mesh-y 0.3..0.7.
// Give the widest squeeze enough room without allowing per-tile auto-fit.
const BOX = [-0.31, 0.20, 0.31, 0.80];
const CW = 210, CH = 210, LABEL = 34;
const W = CW * RECOVERY.length;
const H = (CH + LABEL) * SAMPLE_DT.length;
const img = canvasOf(W, H);

for (let row = 0; row < SAMPLE_DT.length; row++) {
  const t = RELEASE + SAMPLE_DT[row];
  for (let col = 0; col < variants.length; col++) {
    const { seconds, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at recovery=${seconds}, t=${t}`);
    const ox = col * CW, oy = row * (CH + LABEL);
    drawCel(img, W, ox, oy, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(img, W, `R ${seconds.toFixed(2)}S`, ox + 10, oy + CH + 5, 2);
    text(img, W, `+${SAMPLE_DT[row].toFixed(2)}S`, ox + 116, oy + CH + 5, 2);
  }
}

const out = path.join(HERE, 'recovery-sweep.png');
fs.writeFileSync(out, encodePNG(img, W, H));

// Motion is the actual question, so make one animated strip too. Every column
// shares the same clock. The animation begins just before compression finishes
// and runs long enough for the slowest recovery to settle.
const GW = CW * RECOVERY.length, GH = CH + LABEL;
const fps = 20;
const t0 = 0.68, t1 = 1.52;
const n = Math.ceil((t1 - t0) * fps);
const gifFrames = [];
for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const frame = canvasOf(GW, GH);
  for (let col = 0; col < variants.length; col++) {
    const { seconds, K } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at recovery=${seconds}, t=${t}`);
    const ox = col * CW;
    drawCel(frame, GW, ox, 0, CW, CH, K.meshView(), K.idxView(), b.stride, BOX);
    text(frame, GW, `R ${seconds.toFixed(2)}S`, ox + 16, CH + 5, 2);
  }
  gifFrames.push(frame);
}
const gifOut = path.join(HERE, 'recovery-sweep.gif');
fs.writeFileSync(gifOut, encodeGIF(gifFrames, GW, GH, {
  delay: Math.round(100 / fps),
  loop: 0
}));

console.log(JSON.stringify({
  out,
  gif: gifOut,
  axis: 'recovery_seconds',
  values: RECOVERY,
  sample_after_release: SAMPLE_DT,
  ceiling: variants[0].header.maxVerts,
  width: W,
  height: H,
  gif_frames: gifFrames.length,
  gif_fps: fps
}, null, 2));
