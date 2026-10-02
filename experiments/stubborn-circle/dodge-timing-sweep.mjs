// Experiment 06: decision latency.
//
// Spatial choice worked, so sweep WHEN the dodge begins.
// One axis: lead time before the second press closes.
// Move duration and distance stay fixed.
//
//   node experiments/stubborn-circle/dodge-timing-sweep.mjs
//
// Writes:
//   experiments/stubborn-circle/dodge-timing.gif
//   experiments/stubborn-circle/dodge-timing.png

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PI2 = Math.PI / 2;
const DODGE_X = 0.58;
const CONTACT = 1.58;
const MOVE = 0.14;
const LEADS = [0.36, 0.28, 0.20, 0.14, 0.08];

const LIN_HO = [1/3, 1/3], LIN_HI = [-1/3, -1/3];
const beat = (pose, t) => ({ pose, t, ho: LIN_HO, hi: LIN_HI });

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

// Second approach is a single authored linear path for the mechanism.
// Extra body beats sample this path exactly, so changing dodge time does not
// silently change the paddles.
const barAt = (t) => {
  if (t <= 1.20) return [0.18, 0.82];
  if (t < CONTACT) {
    const u = (t - 1.20) / (CONTACT - 1.20);
    return [0.18 + 0.17*u, 0.82 - 0.17*u];
  }
  if (t <= 1.72) return [0.35, 0.65];
  if (t < 1.86) {
    const u = (t - 1.72) / 0.14;
    return [0.35 - 0.17*u, 0.65 + 0.17*u];
  }
  return [0.18, 0.82];
};

const makePose = (name, t, x, sy=1) => {
  const [top,bottom] = barAt(t);
  return [name, { body: body(sy, x), ...bars(top,bottom) }];
};

const makeDoc = (lead) => {
  const start = CONTACT - lead;
  const end = start + MOVE;

  // Where the body ACTUALLY is when contact happens. This matters for the
  // late lanes: the visual pass caught an earlier version snapping them fully
  // clear at CONTACT, accidentally shortening the fixed 0.14 s move.
  const contactProgress = Math.max(0, Math.min(1, (CONTACT - start) / MOVE));
  const contactX = DODGE_X * contactProgress;

  const poseEntries = [
    ['openRound', { body: body(1,0), ...bars(0.18,0.82) }],
    ['closedSquash', { body: body(0.61,0), ...bars(0.35,0.65) }],
    makePose('approach', 1.20, 0),
    makePose('dodgeStart', start, 0),
    makePose('dodgeEnd', end, DODGE_X),
    makePose('atContact', CONTACT, contactX),
    makePose('heldAway', 1.72, DODGE_X),
    makePose('openAway', 1.86, DODGE_X),
    ['openHome', { body: body(1,0), ...bars(0.18,0.82) }],
  ];
  const poses = Object.fromEntries(poseEntries);

  // Beats are sorted by the compiler, but keep them in narrative order here.
  // For the very-late case dodgeEnd lands after CONTACT, so insert both beats
  // and let time sorting preserve the intended crossing.
  const second = [
    beat('approach', 1.20),
    beat('dodgeStart', start),
    beat('dodgeEnd', end),
    beat('atContact', CONTACT),
    beat('heldAway', 1.72),
    beat('openAway', 1.86),
    beat('openHome', 2.14),
    beat('openHome', 2.30),
  ];

  return {
    name: `stubborn-circle-dodge-lead-${lead.toFixed(2)}`,
    v: 2, w: 760, hpx: 700, style: 'flat', dw: 1.0,
    pal: { BODY:'#F4C542', PRESS:'#62758A', INK:'#1A1A24' },
    poses,
    plan: [
      beat('openRound', 0.00),
      beat('openRound', 0.28),
      beat('closedSquash', 0.48),
      beat('closedSquash', 0.66),
      beat('openRound', 0.80),
      beat('openRound', 1.12),
      ...second,
    ],
    loop: false,
    parts: [
      { id:'body', kind:'solid', y:[0.30,0.70], w:0.20, shape:'ball',
        a:'BODY', b:'BODY' },
      { id:'topPress', kind:'limb', ...bar(0.18), w:0.030, taper:0,
        a:'PRESS', b:'PRESS' },
      { id:'bottomPress', kind:'limb', ...bar(0.82), w:0.030, taper:0,
        a:'PRESS', b:'PRESS' },
    ],
  };
};

const variants=[];
for (const lead of LEADS) {
  const {K,header,info}=await loadCast(makeDoc(lead));
  if (info.formatVersion !== 1) throw new Error('timing sweep did not compile v1');
  if (variants.length && header.maxVerts !== variants[0].header.maxVerts)
    throw new Error('dodge timing changed the ceiling');
  variants.push({lead,K,header});
}

const BOX=[-0.45,0.05,0.86,0.95];
const CW=260, CH=300, LABEL=36;
const W=CW*variants.length, H=CH+LABEL;
const fps=20, t0=0.18, t1=2.34;
const n=Math.ceil((t1-t0)*fps);
const frames=[];

for(let f=0;f<n;f++){
  const t=t0+(f/(n-1))*(t1-t0);
  const img=canvasOf(W,H);
  for(let col=0;col<variants.length;col++){
    const {lead,K}=variants[col];
    const b=K.build(t);
    if(b.overflow||b.grew) throw new Error(`runtime alarm lead=${lead} t=${t}`);
    drawCel(img,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
    text(img,W,`LEAD ${lead.toFixed(2)}S`,col*CW+58,CH+7,2);
  }
  frames.push(img);
}
const gifOut=path.join(HERE,'dodge-timing.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// One frame just before contact: how much commitment is visible?
const stillT=1.52;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {lead,K}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,`LEAD ${lead.toFixed(2)}S`,col*CW+58,CH+7,2);
}
const pngOut=path.join(HERE,'dodge-timing.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  axis:'dodge_lead_seconds_before_contact',
  values:LEADS,contact:CONTACT,move_seconds:MOVE,
  ceiling:variants[0].header.maxVerts,frames:n,fps
},null,2));
