// Experiment 10: expectation makes absence visible.
//
// Establish a reciprocal rule twice:
//   A is squeezed -> B visits.
//   B is squeezed -> A visits.
//
// Then squeeze A a second time. Only B's third response changes:
//   AFTER — repeats the established rule after release.
//   EARLY — begins moving while A is still squeezed.
//   NONE  — does not move.
//
// If NONE reads as an event rather than as "nothing happened", the audience is
// carrying a temporal expectation forward. Stillness has acquired meaning.
//
// Writes expectation-ab.gif / expectation-ab.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const LX=-0.34, RX=0.34;
const VISIT=0.14;

const segment=(x,y,half=0.25)=>({
  from:[x-half,y], mid:[x,y], to:[x+half,y],
});
const station=(prefix,x,top,bottom)=>({
  [`${prefix}Top`]:segment(x,top),
  [`${prefix}Bottom`]:segment(x,bottom),
});
const body=(sy=1,offset_x=0)=>({
  scale_x:1/Math.sqrt(sy), scale_y:sy, offset_x,
});

const CASES=[
  {name:'AFTER', mode:'after'},
  {name:'EARLY', mode:'early'},
  {name:'NONE',  mode:'none'},
];

const makeDoc=({name,mode})=>{
  const LO=station('left',LX,0.18,0.82);
  const LC=station('left',LX,0.35,0.65);
  const RO=station('right',RX,0.18,0.82);
  const RC=station('right',RX,0.35,0.65);

  const pose=(lSy,rSy,lDx,rDx,lPress,rPress)=>({
    leftBody:body(lSy,lDx),
    rightBody:body(rSy,rDx),
    ...lPress,...rPress,
  });

  const poses={
    open:        pose(1,1,0,0,LO,RO),
    leftSquash:  pose(0.61,1,0,0,LC,RO),
    rightNear:   pose(1,1,0,-VISIT,LO,RO),
    rightHome:   pose(1,1,0,0,LO,RO),

    rightSquash: pose(1,0.61,0,0,LO,RC),
    leftNear:    pose(1,1,VISIT,0,LO,RO),
    leftHome:    pose(1,1,0,0,LO,RO),

    // Third event variants. EARLY keeps the body elongated only because A is
    // still under pressure; B itself remains canonical.
    thirdSquashHome: pose(0.61,1,0,0,LC,RO),
    thirdSquashNear: pose(0.61,1,0,-VISIT,LC,RO),
    thirdOpenHome:   pose(1,1,0,0,LO,RO),
    thirdOpenNear:   pose(1,1,0,-VISIT,LO,RO),
  };

  const third = mode === 'after' ? [
    {pose:'thirdSquashHome',t:3.16},
    {pose:'thirdSquashHome',t:3.34},
    {pose:'thirdOpenHome',t:3.48},
    {pose:'thirdOpenHome',t:3.64},
    {pose:'thirdOpenNear',t:3.82},
    {pose:'thirdOpenNear',t:4.04},
  ] : mode === 'early' ? [
    {pose:'thirdSquashHome',t:3.16},
    // B commits while A is still squeezed.
    {pose:'thirdSquashNear',t:3.34},
    {pose:'thirdOpenNear',t:3.48},
    {pose:'thirdOpenNear',t:4.04},
  ] : [
    {pose:'thirdSquashHome',t:3.16},
    {pose:'thirdSquashHome',t:3.34},
    {pose:'thirdOpenHome',t:3.48},
    {pose:'thirdOpenHome',t:4.04},
  ];

  return {
    name:`stubborn-circle-expectation-${name.toLowerCase()}`,
    v:2,w:900,hpx:700,style:'flat',dw:1,
    pal:{LEFT:'#F4C542',RIGHT:'#6CC8C2',PRESS:'#62758A'},
    poses,
    plan:[
      {pose:'open',t:0.00},
      {pose:'open',t:0.24},

      // Rule example 1: A is squeezed; B visits after.
      {pose:'leftSquash',t:0.44},
      {pose:'leftSquash',t:0.62},
      {pose:'open',t:0.76},
      {pose:'open',t:0.90},
      {pose:'rightNear',t:1.08},
      {pose:'rightNear',t:1.24},
      {pose:'rightHome',t:1.42},
      {pose:'rightHome',t:1.60},

      // Rule example 2: roles reverse; A does the same.
      {pose:'rightSquash',t:1.80},
      {pose:'rightSquash',t:1.98},
      {pose:'open',t:2.12},
      {pose:'open',t:2.26},
      {pose:'leftNear',t:2.44},
      {pose:'leftNear',t:2.60},
      {pose:'leftHome',t:2.78},
      {pose:'leftHome',t:2.96},

      // Third event: now an expectation exists.
      ...third,
    ],
    loop:false,
    parts:[
      {id:'leftBody',kind:'solid',x:LX,y:[0.30,0.70],w:0.16,shape:'ball',
       a:'LEFT',b:'LEFT'},
      {id:'rightBody',kind:'solid',x:RX,y:[0.30,0.70],w:0.16,shape:'ball',
       a:'RIGHT',b:'RIGHT'},
      {id:'leftTop',kind:'limb',...segment(LX,0.18),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'leftBottom',kind:'limb',...segment(LX,0.82),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'rightTop',kind:'limb',...segment(RX,0.18),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
      {id:'rightBottom',kind:'limb',...segment(RX,0.82),w:0.023,taper:0,
       a:'PRESS',b:'PRESS'},
    ],
  };
};

const variants=[];
for(const c of CASES){
  const {K,header,info}=await loadCast(makeDoc(c));
  if(info.formatVersion!==1) throw new Error('expectation test must exercise binary v1');
  if(variants.length && header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('expectation changed the ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.72,0.10,0.72,0.90];
const CW=360,CH=310,LABEL=36;
const W=CW*variants.length,H=CH+LABEL;
const fps=18,t0=0.10,t1=4.08;
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
const gifOut=path.join(HERE,'expectation-ab.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still just after the third pressure releases.
const stillT=3.56;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+132,CH+7,2);
}
const pngOut=path.join(HERE,'expectation-ab.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can an established temporal rule make early action and inaction legible?',
  cases:CASES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
