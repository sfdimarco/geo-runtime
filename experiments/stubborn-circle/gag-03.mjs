// Experiment 16: teach the trick back.
//
// Two bodies, two pressure stations.
//
// Beat A:
//   YELLOW fakes the squeezed shape at the LEFT station.
//   CYAN follows it in.
//   YELLOW exits.
//   LEFT press closes on CYAN.
//
// Reset.
//
// Beat B mirrors the first:
//   CYAN fakes the squeezed shape at the RIGHT station.
//   YELLOW follows it in.
//   CYAN exits.
//   RIGHT press closes on YELLOW.
//
// After release, CYAN gives the tiny vertical punctuation.
//
// Nothing new is invented in Beat B. The joke depends on the audience
// recognizing a learned procedure copied by the other character.
//
// Writes gag-03.gif / gag-03.png.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCast } from '../../bench/kernel.mjs';
import { canvasOf, drawCel, encodePNG } from '../../tools/render.mjs';
import { encodeGIF } from '../../tools/gif.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

const LX=-0.40;
const RX=0.40;
const R=0.15;

const LEFT_SAFE=-0.38;   // yellow -> x=-0.78
const CYAN_TO_LEFT=-0.80;
const CYAN_NEAR_LEFT=-0.49;

const RIGHT_SAFE=0.38;   // cyan -> x=0.78
const YELLOW_TO_RIGHT=0.80;
const YELLOW_NEAR_RIGHT=0.49;

const segment=(x,y,half=0.16)=>({
  from:[x-half,y],mid:[x,y],to:[x+half,y],
});
const station=(prefix,x,top,bottom)=>({
  [`${prefix}Top`]:segment(x,top),
  [`${prefix}Bottom`]:segment(x,bottom),
});
const body=(sy=1,dx=0)=>({
  scale_x:1/Math.sqrt(sy),
  scale_y:sy,
  offset_x:dx,
});

const LO=station('left',LX,0.22,0.78);
const LC=station('left',LX,0.42,0.58);
const RO=station('right',RX,0.22,0.78);
const RC=station('right',RX,0.42,0.58);

const pose=(ySy,cSy,yDx,cDx,lPress,rPress)=>({
  yellow:body(ySy,yDx),
  cyan:body(cSy,cDx),
  ...lPress,
  ...rPress,
});

const poses={
  home:pose(1,1,0,0,LO,RO),

  yellowFake:pose(0.54,1,0,0,LO,RO),
  cyanNearLeft:pose(1,1,0,CYAN_NEAR_LEFT,LO,RO),
  firstSwitch:pose(1,1,LEFT_SAFE,CYAN_TO_LEFT,LO,RO),
  firstTrap:pose(1,0.54,LEFT_SAFE,CYAN_TO_LEFT,LC,RO),
  firstRelease:pose(1,1,LEFT_SAFE,CYAN_TO_LEFT,LO,RO),

  cyanFake:pose(1,0.54,0,0,LO,RO),
  yellowNearRight:pose(1,1,YELLOW_NEAR_RIGHT,0,LO,RO),
  revengeSwitch:pose(1,1,YELLOW_TO_RIGHT,RIGHT_SAFE,LO,RO),
  revengeTrap:pose(0.54,1,YELLOW_TO_RIGHT,RIGHT_SAFE,LO,RC),
  revengeRelease:pose(1,1,YELLOW_TO_RIGHT,RIGHT_SAFE,LO,RO),
  cyanPunctuation:pose(1,1.10,YELLOW_TO_RIGHT,RIGHT_SAFE,LO,RO),
};

const doc={
  name:'stubborn-circle-gag-03',
  v:2,w:960,hpx:600,style:'flat',dw:1,
  pal:{YELLOW:'#F4C542',CYAN:'#6CC8C2',PRESS:'#62758A'},
  poses,
  plan:[
    {pose:'home',t:0.00},{pose:'home',t:0.20},

    // Yellow's trick.
    {pose:'yellowFake',t:0.42},{pose:'yellowFake',t:0.60},
    {pose:'home',t:0.74},
    {pose:'cyanNearLeft',t:0.94},{pose:'cyanNearLeft',t:1.08},
    {pose:'firstSwitch',t:1.32},{pose:'firstSwitch',t:1.44},
    {pose:'firstTrap',t:1.64},{pose:'firstTrap',t:1.82},
    {pose:'firstRelease',t:1.98},{pose:'firstRelease',t:2.14},

    // Reset gives the copied action room to register as a new beat.
    {pose:'home',t:2.42},{pose:'home',t:2.68},

    // Cyan performs the same procedure in mirror image.
    {pose:'cyanFake',t:2.90},{pose:'cyanFake',t:3.08},
    {pose:'home',t:3.22},
    {pose:'yellowNearRight',t:3.42},{pose:'yellowNearRight',t:3.56},
    {pose:'revengeSwitch',t:3.80},{pose:'revengeSwitch',t:3.92},
    {pose:'revengeTrap',t:4.12},{pose:'revengeTrap',t:4.30},
    {pose:'revengeRelease',t:4.46},{pose:'revengeRelease',t:4.62},

    // Borrowed punctuation after borrowed procedure.
    {pose:'cyanPunctuation',t:4.80},
    {pose:'revengeRelease',t:4.96},
    {pose:'revengeRelease',t:5.24},
  ],
  loop:false,
  parts:[
    {id:'yellow',kind:'solid',x:LX,y:[0.35,0.65],w:R,shape:'ball',
     a:'YELLOW',b:'YELLOW'},
    {id:'cyan',kind:'solid',x:RX,y:[0.35,0.65],w:R,shape:'ball',
     a:'CYAN',b:'CYAN'},

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
if(info.formatVersion!==1) throw new Error('gag 03 must exercise binary v1');

const BOX=[-0.94,0.13,0.94,0.87];
const W=860,H=360;
const fps=18,t0=0.08,t1=5.28;
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

const gifOut=path.join(HERE,'gag-03.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still: the copied trap lands on yellow at the opposite station.
const stillT=4.22;
const still=canvasOf(W,H);
const b=K.build(stillT);
drawCel(still,W,0,0,W,H,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
const pngOut=path.join(HERE,'gag-03.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  kind:'mirrored revenge gag experiment',
  question:'Can copying a learned procedure read as one character teaching the trick back?',
  ceiling:header.maxVerts,
  frames:n,fps,
},null,2));
