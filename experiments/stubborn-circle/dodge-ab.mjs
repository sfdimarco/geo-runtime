// Experiment 05: spatial choice.
//
// The first squeeze is identical in both lanes. On the second approach:
// STAY remains in the press and is squeezed again.
// DODGE moves sideways before contact; the paddles close on empty space.
//
// This is the first experiment that requires the subject to choose a PLACE,
// not just a shape. It exercises .geo binary v1 solid offset_x.
//
//   node experiments/stubborn-circle/dodge-ab.mjs
//
// Writes:
//   experiments/stubborn-circle/dodge-ab.gif
//   experiments/stubborn-circle/dodge-ab.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PI2 = Math.PI / 2;
const DODGE_X = 0.58;

const bar = (y) => ({
  from: { r: 0.34, az: -PI2, y },
  mid:  { r: 0.00, az: 0,    y },
  to:   { r: 0.34, az:  PI2, y },
});
const bars = (topY, bottomY) => ({
  topPress: bar(topY),
  bottomPress: bar(bottomY),
});
const body = (sy=1, offset_x=0) => ({
  scale_x: 1 / Math.sqrt(sy),
  scale_y: sy,
  offset_x,
});

const makeDoc = (dodge) => {
  const open = bars(0.18, 0.82);
  const near = bars(0.26, 0.74);
  const closed = bars(0.35, 0.65);

  const poses = {
    openRound:    { body: body(1, 0), ...open },
    nearRound:    { body: body(1, 0), ...near },
    closedSquash: { body: body(0.61, 0), ...closed },

    // Spatial branch for the second event.
    openDodge:    { body: body(1, DODGE_X), ...open },
    nearDodge:    { body: body(1, DODGE_X), ...near },
    closedDodge:  { body: body(1, DODGE_X), ...closed },
  };

  const secondOpen = dodge ? 'openDodge' : 'openRound';
  const secondNear = dodge ? 'nearDodge' : 'nearRound';
  const secondClose = dodge ? 'closedDodge' : 'closedSquash';

  return {
    name: dodge ? 'stubborn-circle-dodge' : 'stubborn-circle-stay',
    v: 2, w: 760, hpx: 700, style: 'flat', dw: 1.0,
    pal: {
      BODY: '#F4C542',
      PRESS: '#62758A',
      INK: '#1A1A24',
    },
    poses,
    plan: [
      // First event: shared history.
      { pose: 'openRound',    t: 0.00 },
      { pose: 'openRound',    t: 0.28 },
      { pose: 'closedSquash', t: 0.48 },
      { pose: 'closedSquash', t: 0.66 },
      { pose: 'openRound',    t: 0.80 },
      { pose: 'openRound',    t: 1.12 },

      // Second approach: same threat, different spatial decision.
      { pose: secondOpen,     t: 1.30 },
      { pose: secondNear,     t: 1.44 },
      { pose: secondClose,    t: 1.58 },
      { pose: secondClose,    t: 1.72 },
      { pose: secondOpen,     t: 1.86 },
      // Return only after the mechanism is safely open.
      { pose: 'openRound',    t: 2.14 },
      { pose: 'openRound',    t: 2.34 },
    ],
    loop: false,
    parts: [
      {
        id: 'body', kind: 'solid',
        y: [0.30, 0.70], w: 0.20, shape: 'ball',
        a: 'BODY', b: 'BODY',
      },
      {
        id: 'topPress', kind: 'limb',
        ...bar(0.18), w: 0.030, taper: 0,
        a: 'PRESS', b: 'PRESS',
      },
      {
        id: 'bottomPress', kind: 'limb',
        ...bar(0.82), w: 0.030, taper: 0,
        a: 'PRESS', b: 'PRESS',
      },
    ],
  };
};

const CASES = [
  { name: 'STAY', dodge: false },
  { name: 'DODGE', dodge: true },
];

const variants = [];
for (const c of CASES) {
  const { K, header, info } = await loadCast(makeDoc(c.dodge));
  variants.push({ ...c, K, header, info });
}
if (variants[0].header.maxVerts !== variants[1].header.maxVerts) {
  throw new Error('spatial choice changed the vertex ceiling');
}
if (variants[1].info.formatVersion !== 1) {
  throw new Error('dodge did not compile as .geo binary v1');
}

const BOX = [-0.45, 0.05, 0.86, 0.95];
const CW = 460, CH = 400, LABEL = 36;
const W = CW * CASES.length, H = CH + LABEL;
const fps = 24;
const t0 = 0.12, t1 = 2.38;
const n = Math.ceil((t1 - t0) * fps);
const frames = [];

for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const img = canvasOf(W, H);
  for (let col = 0; col < variants.length; col++) {
    const { K, name } = variants[col];
    const b = K.build(t);
    if (b.overflow || b.grew) throw new Error(`runtime alarm at ${name}, t=${t}`);
    drawCel(img, W, col * CW, 0, CW, CH,
      K.meshView(), K.idxView(), b.stride, BOX, K.groupsView());
    text(img, W, name, col * CW + 188, CH + 7, 2);
  }
  frames.push(img);
}

const gifOut = path.join(HERE, 'dodge-ab.gif');
fs.writeFileSync(gifOut, encodeGIF(frames, W, H, {
  delay: Math.round(100 / fps), loop: 0,
}));

// The punchline frame: paddles are closed for the second time.
const stillT = 1.66;
const still = canvasOf(W, H);
for (let col = 0; col < variants.length; col++) {
  const { K, name } = variants[col];
  const b = K.build(stillT);
  drawCel(still, W, col * CW, 0, CW, CH,
    K.meshView(), K.idxView(), b.stride, BOX, K.groupsView());
  text(still, W, name, col * CW + 188, CH + 7, 2);
}
const pngOut = path.join(HERE, 'dodge-ab.png');
fs.writeFileSync(pngOut, encodePNG(still, W, H));

console.log(JSON.stringify({
  gif: gifOut,
  png: pngOut,
  question: 'Does remembered pressure become a joke when the subject can choose space?',
  dodge_x: DODGE_X,
  stay_format_version: variants[0].info.formatVersion,
  dodge_format_version: variants[1].info.formatVersion,
  ceiling: variants[0].header.maxVerts,
  frames: n,
  fps,
}, null, 2));
