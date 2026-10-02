// Experiment 04: memory without a face.
//
// Two identical pressure events. The FIRST is exactly the same in every lane.
// Only the subject's behavior BEFORE the SECOND contact changes.
//
// NAIVE — waits to be squeezed again.
// BRACE — stretches taller before contact, pushing back into the approaching force.
// YIELD — pre-squashes before contact, giving the force what it is about to ask for.
//
// If those reads separate, the audience is inferring memory / expectation from
// temporal structure alone.
//
//   node experiments/stubborn-circle/memory-ab.mjs
//
// Writes:
//   experiments/stubborn-circle/memory-ab.gif
//   experiments/stubborn-circle/memory-ab.png

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
const bars = (topY, bottomY) => ({
  topPress: bar(topY),
  bottomPress: bar(bottomY),
});

const sxFor = sy => 1 / Math.sqrt(sy);
const body = sy => ({ scale_x: sxFor(sy), scale_y: sy });

const CASES = [
  { name: 'NAIVE', prepareY: 1.00 },
  { name: 'BRACE', prepareY: 1.12 },
  { name: 'YIELD', prepareY: 0.84 },
];

const makeDoc = ({ name, prepareY }) => {
  const open = bars(0.18, 0.82);
  const closed = bars(0.35, 0.65);

  const poses = {
    openRound:   { body: body(1.00), ...open },
    closedSquash:{ body: body(0.61), ...closed },
    prepare:     { body: body(prepareY), ...open },
    prepareNear: { body: body(prepareY), ...bars(0.25, 0.75) },
  };

  // Event 1 teaches the relation: paddles approach -> squeeze -> release.
  // Event 2 repeats the approach. The only divergence happens BEFORE contact.
  return {
    name: `stubborn-circle-memory-${name.toLowerCase()}`,
    v: 2, w: 700, hpx: 700, style: 'flat', dw: 1.0,
    pal: {
      BODY: '#F4C542',
      PRESS: '#62758A',
      INK: '#1A1A24',
    },
    poses,
    plan: [
      // First event: identical in all lanes.
      { pose: 'openRound',    t: 0.00 },
      { pose: 'openRound',    t: 0.28 },
      { pose: 'closedSquash', t: 0.48 },
      { pose: 'closedSquash', t: 0.66 },
      { pose: 'openRound',    t: 0.80 },
      { pose: 'openRound',    t: 1.12 },

      // Second event begins. At 1.26 paddles have not touched.
      // NAIVE remains round; BRACE/YIELD already alter themselves.
      { pose: 'prepare',      t: 1.20 },
      { pose: 'prepareNear',  t: 1.36 },
      { pose: 'closedSquash', t: 1.54 },
      { pose: 'closedSquash', t: 1.68 },
      { pose: 'openRound',    t: 1.82 },
      { pose: 'openRound',    t: 2.06 },
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

const variants = [];
for (const c of CASES) {
  const { K, header } = await loadCast(makeDoc(c));
  if (variants.length && header.maxVerts !== variants[0].header.maxVerts) {
    throw new Error('memory A/B changed the vertex ceiling');
  }
  variants.push({ ...c, K, header });
}

const BOX = [-0.43, 0.08, 0.43, 0.92];
const CW = 320, CH = 360, LABEL = 36;
const W = CW * CASES.length, H = CH + LABEL;
const fps = 24;
const t0 = 0.12, t1 = 2.08;
const n = Math.ceil((t1 - t0) * fps);
const frames = [];

for (let f = 0; f < n; f++) {
  const t = t0 + (f / (n - 1)) * (t1 - t0);
  const img = canvasOf(W, H);
  for (let col = 0; col < variants.length; col++) {
    const { K, name } = variants[col];
    const b = K.build(t);
    if (b.overflow) throw new Error(`overflow at ${name}, t=${t}`);
    drawCel(img, W, col * CW, 0, CW, CH,
      K.meshView(), K.idxView(), b.stride, BOX, K.groupsView());
    text(img, W, name, col * CW + 116, CH + 7, 2);
  }
  frames.push(img);
}

const gifOut = path.join(HERE, 'memory-ab.gif');
fs.writeFileSync(gifOut, encodeGIF(frames, W, H, {
  delay: Math.round(100 / fps), loop: 0,
}));

// Still taken during the second approach, before contact. This is the whole
// experiment in one frame: the environment is identical; only expectation differs.
const stillT = 1.34;
const still = canvasOf(W, H);
for (let col = 0; col < variants.length; col++) {
  const { K, name } = variants[col];
  const b = K.build(stillT);
  drawCel(still, W, col * CW, 0, CW, CH,
    K.meshView(), K.idxView(), b.stride, BOX, K.groupsView());
  text(still, W, name, col * CW + 116, CH + 7, 2);
}
const pngOut = path.join(HERE, 'memory-ab.png');
fs.writeFileSync(pngOut, encodePNG(still, W, H));

console.log(JSON.stringify({
  gif: gifOut,
  png: pngOut,
  question: 'Can repeated causality imply memory before a second contact?',
  cases: CASES,
  second_contact: 1.54,
  still_time: stillT,
  ceiling: variants[0].header.maxVerts,
  frames: n,
  fps,
}, null, 2));
