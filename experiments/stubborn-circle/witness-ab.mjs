// Experiment 07: a witness.
//
// Two faceless solids. Only the left one is squeezed.
// After the event, the untouched right one does exactly one thing:
// stay, move closer, or move away.
//
// If those three moves create different RELATIONSHIPS, then the grammar has
// crossed from individual temperament into social storytelling.
//
//   node experiments/stubborn-circle/witness-ab.mjs
//
// Writes witness-ab.gif / witness-ab.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

const PRESS_X=-0.32;
const A_X=-0.32;
const B_X=0.32;
const REACT={
  STILL:0.00,
  CLOSER:-0.18,
  AWAY:0.18,
};

const bar=(y)=>({
  from:[PRESS_X-0.28,y],
  mid:[PRESS_X,y],
  to:[PRESS_X+0.28,y],
});
const bars=(top,bottom)=>({
  topPress:bar(top),
  bottomPress:bar(bottom),
});
const body=(sy=1,offset_x=0)=>({
  scale_x:1/Math.sqrt(sy),
  scale_y:sy,
  offset_x,
});

const makeDoc=(name,move)=>{
  const open=bars(0.18,0.82);
  const closed=bars(0.35,0.65);
  const poses={
    open:{
      subject:body(1,0),
      witness:body(1,0),
      ...open,
    },
    squeeze:{
      subject:body(0.61,0),
      witness:body(1,0),
      ...closed,
    },
    released:{
      subject:body(1,0),
      witness:body(1,0),
      ...open,
    },
    reaction:{
      subject:body(1,0),
      witness:body(1,move),
      ...open,
    },
  };

  return {
    name:`stubborn-circle-witness-${name.toLowerCase()}`,
    v:2,w:760,hpx:700,style:'flat',dw:1,
    pal:{
      SUBJECT:'#F4C542',
      WITNESS:'#6CC8C2',
      PRESS:'#62758A',
    },
    poses,
    plan:[
      {pose:'open',t:0.00},
      {pose:'open',t:0.28},
      {pose:'squeeze',t:0.48},
      {pose:'squeeze',t:0.66},
      {pose:'released',t:0.80},
      // Empty beat: the cause is over before the witness acts.
      {pose:'released',t:0.98},
      {pose:'reaction',t:1.16},
      {pose:'reaction',t:1.48},
    ],
    loop:false,
    parts:[
      {id:'subject',kind:'solid',x:A_X,y:[0.30,0.70],w:0.17,shape:'ball',
       a:'SUBJECT',b:'SUBJECT'},
      {id:'witness',kind:'solid',x:B_X,y:[0.33,0.67],w:0.145,shape:'ball',
       a:'WITNESS',b:'WITNESS'},
      {id:'topPress',kind:'limb',...bar(0.18),w:0.025,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'bottomPress',kind:'limb',...bar(0.82),w:0.025,taper:0,
       a:'PRESS',b:'PRESS'},
    ],
  };
};

const CASES=Object.entries(REACT).map(([name,move])=>({name,move}));
const variants=[];
for(const c of CASES){
  const {K,header,info}=await loadCast(makeDoc(c.name,c.move));
  if(info.formatVersion!==1) throw new Error('witness test must exercise binary v1');
  if(variants.length&&header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('witness choice changed the ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.72,0.12,0.72,0.88];
const CW=350,CH=300,LABEL=36;
const W=CW*variants.length,H=CH+LABEL;
const fps=20,t0=0.14,t1=1.52;
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
const gifOut=path.join(HERE,'witness-ab.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Still after the witness has made its choice.
const stillT=1.30;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+132,CH+7,2);
}
const pngOut=path.join(HERE,'witness-ab.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can an untouched body create relationship by reacting to another body event?',
  reactions:CASES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
