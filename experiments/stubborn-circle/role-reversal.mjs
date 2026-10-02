// Experiment 09: role reversal / callback.
//
// Two bodies, two identical pressure stations.
//
// 1. LEFT subject is squeezed.
// 2. RIGHT body leaves its own station, moves toward LEFT, waits, returns.
// 3. Later RIGHT is squeezed.
// 4. Only LEFT's response changes: STILL / TOWARD / AWAY.
//
// The geometry of TOWARD is not new. The question is whether repetition gives
// it a new meaning: does the audience read a callback because the other body
// made the same kind of move earlier?
//
// Writes role-reversal.gif / role-reversal.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const LEFT_X=-0.34, RIGHT_X=0.34;
const VISIT=-0.14;
const RESPONSE=0.14;

const segment=(x,y,half=0.25)=>({
  from:[x-half,y],
  mid:[x,y],
  to:[x+half,y],
});
const station=(prefix,x,top,bottom)=>({
  [`${prefix}Top`]:segment(x,top),
  [`${prefix}Bottom`]:segment(x,bottom),
});
const body=(sy=1,offset_x=0)=>({
  scale_x:1/Math.sqrt(sy),
  scale_y:sy,
  offset_x,
});

const RESPONSES=[
  {name:'STILL',dx:0},
  {name:'TOWARD',dx:RESPONSE},
  {name:'AWAY',dx:-RESPONSE},
];

const makeDoc=({name,dx})=>{
  const leftOpen=station('left',LEFT_X,0.18,0.82);
  const leftClosed=station('left',LEFT_X,0.35,0.65);
  const rightOpen=station('right',RIGHT_X,0.18,0.82);
  const rightClosed=station('right',RIGHT_X,0.35,0.65);

  const pose=(leftSy,rightSy,rightOff,leftOff,lPress,rPress)=>({
    leftBody:body(leftSy,leftOff),
    rightBody:body(rightSy,rightOff),
    ...lPress,
    ...rPress,
  });

  const poses={
    bothOpen: pose(1,1,0,0,leftOpen,rightOpen),

    leftSqueezed: pose(0.61,1,0,0,leftClosed,rightOpen),
    afterLeft: pose(1,1,0,0,leftOpen,rightOpen),
    rightVisits: pose(1,1,VISIT,0,leftOpen,rightOpen),
    rightHome: pose(1,1,0,0,leftOpen,rightOpen),

    rightSqueezed: pose(1,0.61,0,0,leftOpen,rightClosed),
    afterRight: pose(1,1,0,0,leftOpen,rightOpen),
    leftReplies: pose(1,1,0,dx,leftOpen,rightOpen),
  };

  return {
    name:`stubborn-circle-role-reversal-${name.toLowerCase()}`,
    v:2,w:900,hpx:700,style:'flat',dw:1,
    pal:{
      LEFT:'#F4C542',
      RIGHT:'#6CC8C2',
      PRESS:'#62758A',
    },
    poses,
    plan:[
      {pose:'bothOpen',      t:0.00},
      {pose:'bothOpen',      t:0.28},

      {pose:'leftSqueezed',  t:0.48},
      {pose:'leftSqueezed',  t:0.66},
      {pose:'afterLeft',     t:0.80},
      {pose:'afterLeft',     t:0.98},
      {pose:'rightVisits',   t:1.16},
      {pose:'rightVisits',   t:1.34},
      {pose:'rightHome',     t:1.52},
      {pose:'rightHome',     t:1.76},

      {pose:'rightSqueezed', t:1.96},
      {pose:'rightSqueezed', t:2.14},
      {pose:'afterRight',    t:2.28},
      {pose:'afterRight',    t:2.46},

      {pose:'leftReplies',   t:2.64},
      {pose:'leftReplies',   t:2.94},
    ],
    loop:false,
    parts:[
      {id:'leftBody',kind:'solid',x:LEFT_X,y:[0.30,0.70],w:0.16,shape:'ball',
       a:'LEFT',b:'LEFT'},
      {id:'rightBody',kind:'solid',x:RIGHT_X,y:[0.30,0.70],w:0.16,shape:'ball',
       a:'RIGHT',b:'RIGHT'},

      {id:'leftTop',kind:'limb',...segment(LEFT_X,0.18),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'leftBottom',kind:'limb',...segment(LEFT_X,0.82),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'rightTop',kind:'limb',...segment(RIGHT_X,0.18),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'rightBottom',kind:'limb',...segment(RIGHT_X,0.82),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
    ],
  };
};

const variants=[];
for(const c of RESPONSES){
  const {K,header,info}=await loadCast(makeDoc(c));
  if(info.formatVersion!==1) throw new Error('role reversal must exercise binary v1');
  if(variants.length && header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('role reversal changed the ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.72,0.10,0.72,0.90];
const CW=360,CH=310,LABEL=36;
const W=CW*variants.length,H=CH+LABEL;
const fps=20,t0=0.12,t1=2.98;
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
const gifOut=path.join(HERE,'role-reversal.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

const stillT=2.78;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+132,CH+7,2);
}
const pngOut=path.join(HERE,'role-reversal.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can repeated blocking turn a simple translation into a callback?',
  first_visit:VISIT,
  responses:RESPONSES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
