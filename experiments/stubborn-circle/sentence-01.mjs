// Experiment 12: first sentence.
//
// Not a sweep. Not a final cartoon. A compositional test made only from grammar
// the previous experiments earned:
//
// pressure -> witness -> reciprocity -> memory -> joint spatial choice.
//
// Two round bodies occupy separate pressure stations.
// Each sees the other get squeezed and leaves its own station to visit.
// When both stations threaten them together, they move into the shared middle.
// The presses close on empty space. After a beat, they make one small shared
// stretch, then return to round.
//
// No face, dialogue, title, lore, or explanatory label.
//
// Writes sentence-01.gif / sentence-01.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

const LX=-0.48,RX=0.48;
const R=0.15;
const Y0=0.35,Y1=0.65;       // true front-view circle: height = 2R
const BAR_HALF=0.16;
const VISIT_RIGHT=-0.56;      // right body -> x=-0.08
const VISIT_LEFT=0.56;        // left body  -> x=+0.08
const MEET_LEFT=0.325;        // left body  -> x=-0.155
const MEET_RIGHT=-0.325;      // right body -> x=+0.155

const segment=(x,y)=>({
  from:[x-BAR_HALF,y],mid:[x,y],to:[x+BAR_HALF,y],
});
const station=(prefix,x,top,bottom)=>({
  [`${prefix}Top`]:segment(x,top),
  [`${prefix}Bottom`]:segment(x,bottom),
});
const body=(sy=1,dx=0)=>({
  scale_x:1/Math.sqrt(sy),scale_y:sy,offset_x:dx,
});

const LO=station('left',LX,0.22,0.78);
const LC=station('left',LX,0.42,0.58);
const RO=station('right',RX,0.22,0.78);
const RC=station('right',RX,0.42,0.58);

const pose=(lSy,rSy,lDx,rDx,lPress,rPress)=>({
  leftBody:body(lSy,lDx),rightBody:body(rSy,rDx),...lPress,...rPress,
});

const poses={
  open:pose(1,1,0,0,LO,RO),

  leftSquash:pose(0.54,1,0,0,LC,RO),
  rightVisits:pose(1,1,0,VISIT_RIGHT,LO,RO),
  rightHome:pose(1,1,0,0,LO,RO),

  rightSquash:pose(1,0.54,0,0,LO,RC),
  leftVisits:pose(1,1,VISIT_LEFT,0,LO,RO),
  leftHome:pose(1,1,0,0,LO,RO),

  // Both leave before the simultaneous close.
  meetClosed:pose(1,1,MEET_LEFT,MEET_RIGHT,LC,RC),
  meetOpen:pose(1,1,MEET_LEFT,MEET_RIGHT,LO,RO),

  // The original "proud" question returns, now as a shared gesture.
  meetStretch:pose(1.08,1.08,MEET_LEFT,MEET_RIGHT,LO,RO),
};

const doc={
  name:'stubborn-circle-sentence-01',
  v:2,w:900,hpx:600,style:'flat',dw:1,
  pal:{LEFT:'#F4C542',RIGHT:'#6CC8C2',PRESS:'#62758A'},
  poses,
  plan:[
    {pose:'open',t:0.00},{pose:'open',t:0.30},

    {pose:'leftSquash',t:0.50},{pose:'leftSquash',t:0.68},
    {pose:'open',t:0.84},{pose:'open',t:1.00},
    {pose:'rightVisits',t:1.20},{pose:'rightVisits',t:1.38},
    {pose:'rightHome',t:1.58},{pose:'rightHome',t:1.78},

    {pose:'rightSquash',t:1.98},{pose:'rightSquash',t:2.16},
    {pose:'open',t:2.32},{pose:'open',t:2.48},
    {pose:'leftVisits',t:2.68},{pose:'leftVisits',t:2.86},
    {pose:'leftHome',t:3.06},{pose:'leftHome',t:3.30},

    // Shared threat and solution.
    {pose:'meetClosed',t:3.54},{pose:'meetClosed',t:3.72},
    {pose:'meetOpen',t:3.90},{pose:'meetOpen',t:4.12},

    // Small punctuation mark.
    {pose:'meetStretch',t:4.28},
    {pose:'meetOpen',t:4.44},
    {pose:'meetOpen',t:4.84},
  ],
  loop:false,
  parts:[
    {id:'leftBody',kind:'solid',x:LX,y:[Y0,Y1],w:R,shape:'ball',
     a:'LEFT',b:'LEFT'},
    {id:'rightBody',kind:'solid',x:RX,y:[Y0,Y1],w:R,shape:'ball',
     a:'RIGHT',b:'RIGHT'},
    {id:'leftTop',kind:'limb',...segment(LX,0.22),w:0.021,taper:0,
     a:'PRESS',b:'PRESS'},
    {id:'leftBottom',kind:'limb',...segment(LX,0.78),w:0.021,taper:0,
     a:'PRESS',b:'PRESS'},
    {id:'rightTop',kind:'limb',...segment(RX,0.22),w:0.021,taper:0,
     a:'PRESS',b:'PRESS'},
    {id:'rightBottom',kind:'limb',...segment(RX,0.78),w:0.021,taper:0,
     a:'PRESS',b:'PRESS'},
  ],
};

const {K,header,info}=await loadCast(doc);
if(info.formatVersion!==1) throw new Error('sentence 01 must exercise binary v1');

const BOX=[-0.72,0.12,0.72,0.88];
const W=720,H=380;
const fps=18,t0=0.10,t1=4.88;
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

const gifOut=path.join(HERE,'sentence-01.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still: both presses closed, bodies just outside them in the middle.
const stillT=3.66;
const still=canvasOf(W,H);
const b=K.build(stillT);
drawCel(still,W,0,0,W,H,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
const pngOut=path.join(HERE,'sentence-01.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  kind:'compositional experiment',
  duration_seconds:t1-t0,
  ceiling:header.maxVerts,
  frames:n,fps,
},null,2));
