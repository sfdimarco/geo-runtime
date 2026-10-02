// Experiment 11: joint choice.
//
// Establish the two-body history:
//   LEFT squeezed -> RIGHT visits.
//   RIGHT squeezed -> LEFT visits.
//
// Then BOTH pressure stations close at once.
// Change only where the two bodies choose to go:
//
// STAY    — remain in their stations and both deform.
// CENTER  — both leave toward the shared middle; presses close on empty space.
// OUTSIDE — both leave away from each other; presses close on empty space.
//
// CENTER and OUTSIDE solve the same mechanical problem. If they feel different,
// the relation is being authored by spatial choreography rather than outcome.
//
// Writes joint-choice.gif / joint-choice.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG, text } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const LX=-0.34,RX=0.34,VISIT=0.14;

const segment=(x,y,half=0.25)=>({
  from:[x-half,y],mid:[x,y],to:[x+half,y],
});
const station=(prefix,x,top,bottom)=>({
  [`${prefix}Top`]:segment(x,top),
  [`${prefix}Bottom`]:segment(x,bottom),
});
const body=(sy=1,dx=0)=>({
  scale_x:1/Math.sqrt(sy),scale_y:sy,offset_x:dx,
});

const CASES=[
  {name:'STAY',leftDx:0,rightDx:0,squash:true},
  {name:'CENTER',leftDx:0.26,rightDx:-0.26,squash:false},
  {name:'OUTSIDE',leftDx:-0.28,rightDx:0.28,squash:false},
];

const makeDoc=(c)=>{
  const LO=station('left',LX,0.18,0.82);
  const LC=station('left',LX,0.35,0.65);
  const RO=station('right',RX,0.18,0.82);
  const RC=station('right',RX,0.35,0.65);

  const pose=(lSy,rSy,lDx,rDx,lPress,rPress)=>({
    leftBody:body(lSy,lDx),rightBody:body(rSy,rDx),...lPress,...rPress,
  });

  const thirdSy=c.squash?0.61:1;
  const poses={
    open:pose(1,1,0,0,LO,RO),

    leftSquash:pose(0.61,1,0,0,LC,RO),
    rightVisit:pose(1,1,0,-VISIT,LO,RO),
    rightHome:pose(1,1,0,0,LO,RO),

    rightSquash:pose(1,0.61,0,0,LO,RC),
    leftVisit:pose(1,1,VISIT,0,LO,RO),
    leftHome:pose(1,1,0,0,LO,RO),

    // Simultaneous third threat. In escape variants topology stays identical;
    // only offsets change while the presses close.
    jointClosed:pose(thirdSy,thirdSy,c.leftDx,c.rightDx,LC,RC),
    jointOpen:pose(1,1,c.leftDx,c.rightDx,LO,RO),
  };

  return {
    name:`stubborn-circle-joint-${c.name.toLowerCase()}`,
    v:2,w:900,hpx:700,style:'flat',dw:1,
    pal:{LEFT:'#F4C542',RIGHT:'#6CC8C2',PRESS:'#62758A'},
    poses,
    plan:[
      {pose:'open',t:0.00},{pose:'open',t:0.24},

      {pose:'leftSquash',t:0.44},{pose:'leftSquash',t:0.62},
      {pose:'open',t:0.76},{pose:'open',t:0.90},
      {pose:'rightVisit',t:1.08},{pose:'rightVisit',t:1.24},
      {pose:'rightHome',t:1.42},{pose:'rightHome',t:1.60},

      {pose:'rightSquash',t:1.80},{pose:'rightSquash',t:1.98},
      {pose:'open',t:2.12},{pose:'open',t:2.26},
      {pose:'leftVisit',t:2.44},{pose:'leftVisit',t:2.60},
      {pose:'leftHome',t:2.78},{pose:'leftHome',t:3.00},

      // Same threat, three shared choices.
      {pose:'open',t:3.12},
      {pose:'jointClosed',t:3.38},
      {pose:'jointClosed',t:3.56},
      {pose:'jointOpen',t:3.72},
      {pose:'jointOpen',t:4.04},
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
  if(info.formatVersion!==1) throw new Error('joint choice must exercise binary v1');
  if(variants.length&&header.maxVerts!==variants[0].header.maxVerts)
    throw new Error('joint choice changed the ceiling');
  variants.push({...c,K,header});
}

const BOX=[-0.78,0.10,0.78,0.90];
const CW=370,CH=310,LABEL=36;
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
    text(img,W,name,col*CW+138,CH+7,2);
  }
  frames.push(img);
}
const gifOut=path.join(HERE,'joint-choice.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

const stillT=3.50;
const still=canvasOf(W,H);
for(let col=0;col<variants.length;col++){
  const {K,name}=variants[col];
  const b=K.build(stillT);
  drawCel(still,W,col*CW,0,CW,CH,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
  text(still,W,name,col*CW+138,CH+7,2);
}
const pngOut=path.join(HERE,'joint-choice.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  question:'Can two equally successful escapes differ mainly by relationship?',
  cases:CASES,
  ceiling:variants[0].header.maxVerts,
  frames:n,fps,
},null,2));
