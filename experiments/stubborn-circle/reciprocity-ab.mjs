// Experiment 08: reply to the witness.
//
// 07 asked whether an untouched body can create relationship by moving after
// another body is squeezed. This asks whether the first body can ANSWER that.
//
// Shared event:
//   1. yellow subject is squeezed;
//   2. cyan witness waits until the mechanism is gone, then moves closer;
//   3. another empty beat;
//   4. only the yellow subject's reply changes.
//
// STILL  — no reply.
// TOWARD — subject closes some of the remaining gap.
// AWAY   — subject increases the gap.
//
// No face, limbs, gaze, dialogue, or semantic state.
//
//   node experiments/stubborn-circle/reciprocity-ab.mjs
//
// Writes reciprocity-ab.gif / reciprocity-ab.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const PRESS_X = -0.32;
const SUBJECT_X = -0.32;
const WITNESS_X = 0.32;
const WITNESS_NEAR = -0.16; // authored offset: final x = 0.16
const REPLIES = [
  { name: 'STILL',  dx:  0.00 },
  { name: 'TOWARD', dx:  0.10 },
  { name: 'AWAY',   dx: -0.10 },
];

const bar = (y) => ({
  from: [PRESS_X - 0.28, y],
  mid:  [PRESS_X,        y],
  to:   [PRESS_X + 0.28, y],
});
const bars = (top, bottom) => ({
  topPress: bar(top),
  bottomPress: bar(bottom),
});
const body = (sy=1, offset_x=0) => ({
  scale_x: 1 / Math.sqrt(sy),
  scale_y: sy,
  offset_x,
});

const makeDoc = ({name, dx}) => {
  const open = bars(0.18, 0.82);
  const closed = bars(0.35, 0.65);

  const poses = {
    open: {
      subject: body(1, 0),
      witness: body(1, 0),
      ...open,
    },
    squeeze: {
      subject: body(0.61, 0),
      witness: body(1, 0),
      ...closed,
    },
    released: {
      subject: body(1, 0),
      witness: body(1, 0),
      ...open,
    },
    witnessNear: {
      subject: body(1, 0),
      witness: body(1, WITNESS_NEAR),
      ...open,
    },
    reply: {
      subject: body(1, dx),
      witness: body(1, WITNESS_NEAR),
      ...open,
    },
  };

  return {
    name: `stubborn-circle-reciprocity-${name.toLowerCase()}`,
    v: 2, w: 760, hpx: 700, style: 'flat', dw: 1,
    pal: {
      SUBJECT: '#F4C542',
      WITNESS: '#6CC8C2',
      PRESS: '#62758A',
    },
    poses,
    plan: [
      {pose:'open',        t:0.00},
      {pose:'open',        t:0.28},
      {pose:'squeeze',     t:0.48},
      {pose:'squeeze',     t:0.66},
      {pose:'released',    t:0.80},
      {pose:'released',    t:0.98},

      // Witness initiates the social move only after the cause is over.
      {pose:'witnessNear', t:1.16},
      {pose:'witnessNear', t:1.30},

      // Empty beat: give the approach time to become an event of its own.
      {pose:'witnessNear', t:1.46},
      {pose:'reply',       t:1.62},
      {pose:'reply',       t:1.88},
    ],
    loop:false,
    parts:[
      {id:'subject',kind:'solid',x:SUBJECT_X,y:[0.30,0.70],w:0.17,shape:'ball',
       a:'SUBJECT',b:'SUBJECT'},
      {id:'witness',kind:'solid',x:WITNESS_X,y:[0.33,0.67],w:0.145,shape:'ball',
       a:'WITNESS',b:'WITNESS'},
      {id:'topPress',kind:'limb',...bar(0.18),w:0.025,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'bottomPress',kind:'limb',...bar(0.82),w:0.025,taper:0,
       a:'PRESS',b:'PRESS'},
    ],
  };
};

const variants=[];
for(const c of REPLIES){
  const {K,header,info}=await loadCast(makeDoc(c));
  if(info.formatVersion!==1) throw new Error('reciprocity test must exercise binary v1');
  if(variants.length && header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('reciprocity changed the ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.72,0.12,0.72,0.88];
const CW=350,CH=300,LABEL=36;
const W=CW*variants.length,H=CH+LABEL;
const fps=20,t0=0.14,t1=1.92;
const n=Math.ceil((t1-t0)*fps);
const frames=[];

for(let f=0;f<n;f++){
  const t=t0+(f/(n-1))*(t1-t0);
  const img=canvasOf(W,H);
  for(let col=0;col<variants.length;col++){
    const {K,name}=variants[col];
    const b=K.build(t);
    if(b.overflow||b.grew) throw new Error(`runtime alarm ${name} t=${t}`);
    drawCel(img,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
    text(img,W,name,col*CW+128,CH+7,2);
  }
  frames.push(img);
}
const gifOut=path.join(HERE,'reciprocity-ab.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// The still is deliberately AFTER both moves. It cannot prove sequence, but it
// makes the relational geometry inspectable beside the animation.
const stillT=1.74;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+128,CH+7,2);
}
const pngOut=path.join(HERE,'reciprocity-ab.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can one spatial reaction make another spatial reaction read as a reply?',
  witness_offset:WITNESS_NEAR,
  replies:REPLIES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
