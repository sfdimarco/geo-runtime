// Experiment 14: first gag.
//
// Use the learned-signal result compositionally:
//
// 1. Twice, the press genuinely squeezes YELLOW.
// 2. Each time, CYAN comes over afterward.
// 3. On the third round, YELLOW self-squashes while the press stays open.
// 4. CYAN comes over again.
// 5. YELLOW keeps moving left, drawing CYAN fully into the pressure station.
// 6. The press closes on CYAN.
// 7. After release, YELLOW makes one tiny vertical stretch.
//
// No faces, dialogue, title card, or semantic state.
// The question is whether a learned social cue can support a causal joke.
//
// Writes gag-01.gif / gag-01.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

const YX=-0.34;
const CX=0.34;
const R=0.15;
const SAFE=-0.36;       // yellow exits to x=-0.70
const NEAR=-0.37;       // cyan visits to x=-0.03
const STATION=-0.68;    // cyan enters yellow's station at x=-0.34

const segment=(x,y,half=0.18)=>({
  from:[x-half,y],mid:[x,y],to:[x+half,y],
});
const bars=(top,bottom)=>({
  topPress:segment(YX,top),
  bottomPress:segment(YX,bottom),
});
const body=(sy=1,dx=0)=>({
  scale_x:1/Math.sqrt(sy),
  scale_y:sy,
  offset_x:dx,
});

const OPEN=bars(0.22,0.78);
const CLOSED=bars(0.42,0.58);

const poses={
  open:{
    yellow:body(1,0),cyan:body(1,0),...OPEN,
  },
  yellowSquash:{
    yellow:body(0.54,0),cyan:body(1,0),...CLOSED,
  },
  cyanNear:{
    yellow:body(1,0),cyan:body(1,NEAR),...OPEN,
  },
  home:{
    yellow:body(1,0),cyan:body(1,0),...OPEN,
  },

  // The lie: same deformation, no external cause.
  yellowSelf:{
    yellow:body(0.54,0),cyan:body(1,0),...OPEN,
  },

  // Cyan has begun to follow the familiar cue.
  cyanNearAgain:{
    yellow:body(1,0),cyan:body(1,NEAR),...OPEN,
  },

  // Both continue left. Yellow is now safely outside the press;
  // cyan ends exactly in the old yellow station.
  baitSwitch:{
    yellow:body(1,SAFE),cyan:body(1,STATION),...OPEN,
  },

  cyanTrapped:{
    yellow:body(1,SAFE),cyan:body(0.54,STATION),...CLOSED,
  },

  released:{
    yellow:body(1,SAFE),cyan:body(1,STATION),...OPEN,
  },

  // Tiny callback to the earliest "proud" stretch result.
  punctuation:{
    yellow:body(1.10,SAFE),cyan:body(1,STATION),...OPEN,
  },

  exit:{
    yellow:body(1,SAFE),cyan:body(1,0),...OPEN,
  },
};

const doc={
  name:'stubborn-circle-gag-01',
  v:2,w:900,hpx:600,style:'flat',dw:1,
  pal:{YELLOW:'#F4C542',CYAN:'#6CC8C2',PRESS:'#62758A'},
  poses,
  plan:[
    {pose:'open',t:0.00},{pose:'open',t:0.24},

    // Demonstration 1.
    {pose:'yellowSquash',t:0.46},{pose:'yellowSquash',t:0.64},
    {pose:'open',t:0.78},{pose:'open',t:0.94},
    {pose:'cyanNear',t:1.12},{pose:'cyanNear',t:1.28},
    {pose:'home',t:1.48},{pose:'home',t:1.64},

    // Demonstration 2.
    {pose:'yellowSquash',t:1.86},{pose:'yellowSquash',t:2.04},
    {pose:'open',t:2.18},{pose:'open',t:2.34},
    {pose:'cyanNear',t:2.52},{pose:'cyanNear',t:2.68},
    {pose:'home',t:2.88},{pose:'home',t:3.06},

    // Third round: counterfeit the cue.
    {pose:'yellowSelf',t:3.28},{pose:'yellowSelf',t:3.46},
    {pose:'open',t:3.60},
    {pose:'cyanNearAgain',t:3.80},{pose:'cyanNearAgain',t:3.96},

    // Keep moving. Cyan follows all the way into the old station.
    {pose:'baitSwitch',t:4.20},{pose:'baitSwitch',t:4.34},

    // Mechanical punchline.
    {pose:'cyanTrapped',t:4.54},{pose:'cyanTrapped',t:4.72},
    {pose:'released',t:4.88},{pose:'released',t:5.04},

    // One small nonverbal beat after the consequence.
    {pose:'punctuation',t:5.20},
    {pose:'released',t:5.36},
    {pose:'released',t:5.58},
    {pose:'exit',t:5.86},{pose:'exit',t:6.08},
  ],
  loop:false,
  parts:[
    {id:'yellow',kind:'solid',x:YX,y:[0.35,0.65],w:R,shape:'ball',
     a:'YELLOW',b:'YELLOW'},
    {id:'cyan',kind:'solid',x:CX,y:[0.35,0.65],w:R,shape:'ball',
     a:'CYAN',b:'CYAN'},
    {id:'topPress',kind:'limb',...segment(YX,0.22),w:0.022,taper:0,
     a:'PRESS',b:'PRESS'},
    {id:'bottomPress',kind:'limb',...segment(YX,0.78),w:0.022,taper:0,
     a:'PRESS',b:'PRESS'},
  ],
};

const {K,header,info}=await loadCast(doc);
if(info.formatVersion!==1) throw new Error('gag 01 must exercise binary v1');

const BOX=[-0.88,0.13,0.70,0.87];
const W=760,H=360;
const fps=18,t0=0.10,t1=6.12;
const n=Math.ceil((t1-t0)*fps);
const frames=[];

for(let f=0;f<n;f++){
  const t=t0+(f/(n-1))*(t1-t0);
  const img=canvasOf(W,H);
  const b=K.build(t);
  if(b.overflow||b.grew) throw new Error(`runtime alarm t=${t}`);
  drawCel(img,W,0,0,W,H,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  frames.push(img);
}

const gifOut=path.join(HERE,'gag-01.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still: cyan under the press, yellow safely outside.
const stillT=4.64;
const still=canvasOf(W,H);
const b=K.build(stillT);
drawCel(still,W,0,0,W,H,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
const pngOut=path.join(HERE,'gag-01.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  kind:'causal gag experiment',
  question:'Can a counterfeit learned cue set up a readable mechanical punchline?',
  ceiling:header.maxVerts,
  frames:n,fps,
},null,2));
