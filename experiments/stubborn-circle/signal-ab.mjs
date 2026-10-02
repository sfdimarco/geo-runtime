// Experiment 13: a shape becomes a signal.
//
// Establish the same causal sequence twice:
//   LEFT is squeezed by the press -> after release, RIGHT comes over.
//
// On the third repetition, RIGHT's visit is held constant. Only the cue changes:
//
// REAL — the press actually squeezes LEFT.
// SELF — the press stays open; LEFT voluntarily makes the learned squeezed shape.
// NONE — the press stays open; LEFT stays round.
//
// If SELF makes RIGHT's later visit feel causally motivated while NONE feels
// arbitrary, a deformation has crossed from consequence into communication.
//
// Writes signal-ab.gif / signal-ab.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

const LX=-0.34;
const RX=0.34;
const R=0.15;
const VISIT=-0.37;

const segment=(x,y,half=0.18)=>({
  from:[x-half,y],
  mid:[x,y],
  to:[x+half,y],
});
const bars=(top,bottom)=>({
  topPress:segment(LX,top),
  bottomPress:segment(LX,bottom),
});
const body=(sy=1,dx=0)=>({
  scale_x:1/Math.sqrt(sy),
  scale_y:sy,
  offset_x:dx,
});

const OPEN=bars(0.22,0.78);
const CLOSED=bars(0.42,0.58);

const CASES=[
  {name:'REAL', cue:'real'},
  {name:'SELF', cue:'self'},
  {name:'NONE', cue:'none'},
];

const makeDoc=({name,cue})=>{
  const poses={
    open:{
      leftBody:body(1,0),
      rightBody:body(1,0),
      ...OPEN,
    },
    squeeze:{
      leftBody:body(0.54,0),
      rightBody:body(1,0),
      ...CLOSED,
    },
    witnessNear:{
      leftBody:body(1,0),
      rightBody:body(1,VISIT),
      ...OPEN,
    },
    witnessHome:{
      leftBody:body(1,0),
      rightBody:body(1,0),
      ...OPEN,
    },

    // Third-event cue variants.
    testReal:{
      leftBody:body(0.54,0),
      rightBody:body(1,0),
      ...CLOSED,
    },
    testSelf:{
      leftBody:body(0.54,0),
      rightBody:body(1,0),
      ...OPEN,
    },
    testNone:{
      leftBody:body(1,0),
      rightBody:body(1,0),
      ...OPEN,
    },
  };

  const testPose = cue==='real' ? 'testReal' : cue==='self' ? 'testSelf' : 'testNone';

  return {
    name:`stubborn-circle-signal-${name.toLowerCase()}`,
    v:2,w:840,hpx:600,style:'flat',dw:1,
    pal:{
      LEFT:'#F4C542',
      RIGHT:'#6CC8C2',
      PRESS:'#62758A',
    },
    poses,
    plan:[
      {pose:'open',t:0.00},
      {pose:'open',t:0.24},

      // Demonstration 1.
      {pose:'squeeze',t:0.46},
      {pose:'squeeze',t:0.64},
      {pose:'open',t:0.78},
      {pose:'open',t:0.94},
      {pose:'witnessNear',t:1.12},
      {pose:'witnessNear',t:1.28},
      {pose:'witnessHome',t:1.46},

      // Demonstration 2.
      {pose:'witnessHome',t:1.62},
      {pose:'squeeze',t:1.84},
      {pose:'squeeze',t:2.02},
      {pose:'open',t:2.16},
      {pose:'open',t:2.32},
      {pose:'witnessNear',t:2.50},
      {pose:'witnessNear',t:2.66},
      {pose:'witnessHome',t:2.84},

      // Test: same response, different cue.
      {pose:'witnessHome',t:3.02},
      {pose:testPose,t:3.24},
      {pose:testPose,t:3.42},
      {pose:'open',t:3.56},
      {pose:'open',t:3.72},
      {pose:'witnessNear',t:3.90},
      {pose:'witnessNear',t:4.08},
      {pose:'witnessHome',t:4.30},
      {pose:'witnessHome',t:4.50},
    ],
    loop:false,
    parts:[
      {id:'leftBody',kind:'solid',x:LX,y:[0.35,0.65],w:R,shape:'ball',
       a:'LEFT',b:'LEFT'},
      {id:'rightBody',kind:'solid',x:RX,y:[0.35,0.65],w:R,shape:'ball',
       a:'RIGHT',b:'RIGHT'},
      {id:'topPress',kind:'limb',...segment(LX,0.22),w:0.022,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'bottomPress',kind:'limb',...segment(LX,0.78),w:0.022,taper:0,
       a:'PRESS',b:'PRESS'},
    ],
  };
};

const variants=[];
for(const c of CASES){
  const {K,header,info}=await loadCast(makeDoc(c));
  if(info.formatVersion!==1) throw new Error('signal test must exercise binary v1');
  if(variants.length && header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('signal cue changed the vertex ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.66,0.13,0.66,0.87];
const CW=360,CH=310,LABEL=36;
const W=CW*variants.length,H=CH+LABEL;
const fps=18,t0=0.10,t1=4.54;
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
    text(img,W,name,col*CW+132,CH+7,2);
  }
  frames.push(img);
}

const gifOut=path.join(HERE,'signal-ab.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still: third cue at maximum separation between REAL / SELF / NONE.
const stillT=3.34;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+132,CH+7,2);
}
const pngOut=path.join(HERE,'signal-ab.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can a learned consequence become a social signal when reproduced without its cause?',
  cases:CASES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
