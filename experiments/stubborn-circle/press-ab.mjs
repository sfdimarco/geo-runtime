// Experiment 02: give the deformation a visible cause.
//
// Same circle, same squash, same recovery, same proud gesture.
// A pair of paddles now visibly causes the deformation.
// A/B changes ONE thing: the pause at perfect roundness before the second
// gesture. If the delayed version reads as a response rather than rebound,
// timing has crossed from material behaviour into character behaviour.
//
//   node experiments/stubborn-circle/press-ab.mjs
//
// Writes:
//   experiments/stubborn-circle/press-ab.gif
//   experiments/stubborn-circle/press-ab.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PI2 = Math.PI / 2;
const bar = (y) => ({
  from: { r: 0.34, az: -PI2, y },
  mid:  { r: 0.00, az: 0,    y },
  to:   { r: 0.34, az:  PI2, y },
});
const barPose = (topY, bottomY) => ({
  topPress: bar(topY),
  bottomPress: bar(bottomY),
});

const PROUD = 0.09;
const proudY = 1 + PROUD;
const proudX = 1 / Math.sqrt(proudY);

const makeDoc = (pause) => {
  const openBars = barPose(0.18, 0.82);
  const closedBars = barPose(0.35, 0.65);
  const poses = {
    openRound: {
      body: { scale_x: 1.0, scale_y: 1.0 },
      ...openBars,
    },
    closedSquash: {
      body: { scale_x: 1.2804, scale_y: 0.61 },
      ...closedBars,
    },
    openProud: {
      body: { scale_x: proudX, scale_y: proudY },
      ...openBars,
    },
  };

  const squeezeAt = 0.48;
  const releaseAt = 0.70;
  const roundAt = 0.84;         // fixed 0.14s recovery
  const proudAt = roundAt + pause + 0.10;
  const settleAt = proudAt + 0.13;

  return {
    name: `stubborn-circle-press-pause-${pause.toFixed(2)}`,
    v: 2,
    w: 700,
    hpx: 700,
    style: 'flat',
    dw: 1.0,
    pal: {
      BODY: '#F4C542',
      PRESS: '#62758A',
      INK: '#1A1A24',
    },
    poses,
    plan: [
      { pose: 'openRound', t: 0.00 },
      { pose: 'openRound', t: 0.30 },
      { pose: 'closedSquash', t: squeezeAt },
      { pose: 'closedSquash', t: releaseAt },
      { pose: 'openRound', t: roundAt },
      { pose: 'openRound', t: roundAt + pause },
      { pose: 'openProud', t: proudAt },
      { pose: 'openRound', t: settleAt },
    ],
    loop: false,
    parts: [
      {
        id: 'body',
        kind: 'solid',
        y: [0.30, 0.70],
        w: 0.20,
        shape: 'ball',
        a: 'BODY',
        b: 'BODY',
      },
      {
        id: 'topPress',
        kind: 'limb',
        ...bar(0.18),
        w: 0.030,
        taper: 0,
        a: 'PRESS',
        b: 'PRESS',
      },
      {
        id: 'bottomPress',
        kind: 'limb',
        ...bar(0.82),
        w: 0.030,
        taper: 0,
        a: 'PRESS',
        b: 'PRESS',
      },
    ],
  };
};

const CASES = [
  { pause: 0.00, label: 'PAUSE 0.00S' },
  { pause: 0.14, label: 'PAUSE 0.14S' },
];

const variants = [];
for (const c of CASES) {
  const { K, header } = await loadCast(makeDoc(c.pause));
  variants.push({ ...c, K, header });
}
if (variants[0].header.maxVerts !== variants[1].header.maxVerts) {
  throw new Error('A/B changed the vertex ceiling');
}

const BOX = [-0.43, 0.08, 0.43, 0.92];
const CW = 420, CH = 420, LABEL = 36;
const W = CW * CASES.length, H = CH + LABEL;
const fps = 24;
const t0 = 0.22, t1 = 1.42;
const n = Math.ceil((t1 - t0) * fps);
const frames = [];

for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const img = canvasOf(W, H);
  for (let col = 0; col < variants.length; col++) {
    const { K, label } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at t=${t}`);
    const ox = col * CW;
    drawCel(
      img, W, ox, 0, CW, CH,
      K.meshView(), K.idxView(), b.stride, BOX, K.groupsView()
    );
    text(img, W, label, ox + 118, CH + 7, 2);
  }
  frames.push(img);
}

const gifOut = path.join(HERE, 'press-ab.gif');
fs.writeFileSync(gifOut, encodeGIF(frames, W, H, {
  delay: Math.round(100 / fps),
  loop: 0,
}));

// One diagnostic still at the moment the two performances have diverged.
const stillT = 1.02;
const still = canvasOf(W, H);
for (let col = 0; col < variants.length; col++) {
  const { K, label } = variants[col];
  const b = K.build(stillT);
  drawCel(
    still, W, col * CW, 0, CW, CH,
    K.meshView(), K.idxView(), b.stride, BOX, K.groupsView()
  );
  text(still, W, label, col * CW + 118, CH + 7, 2);
}
const pngOut = path.join(HERE, 'press-ab.png');
fs.writeFileSync(pngOut, encodePNG(still, W, H));

console.log(JSON.stringify({
  gif: gifOut,
  png: pngOut,
  comparison: CASES.map(({pause}) => ({pause})),
  recovery_seconds: 0.14,
  proud_amount: PROUD,
  ceiling: variants[0].header.maxVerts,
  frames: n,
  fps,
}, null, 2));
