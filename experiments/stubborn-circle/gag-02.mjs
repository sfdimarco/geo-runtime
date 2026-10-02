// Experiment 15: the same trick, once too often.
//
// First, replay the essential trap:
//   YELLOW self-squashes -> CYAN follows -> YELLOW exits -> press gets CYAN.
//
// Reset.
//
// Then YELLOW performs the same counterfeit cue again.
// CYAN begins the familiar visit, but stops short of the station.
// YELLOW exits exactly as before. The press closes on empty space.
// CYAN gives the tiny vertical stretch YELLOW used after the first trap.
//
// The question is whether repetition can make "stopping short" read as learned
// distrust and let one character appropriate the other's punctuation.
//
// Writes gag-02.gif / gag-02.png.

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
const SAFE=-0.36;       // yellow -> x=-0.70
const NEAR=-0.37;       // cyan -> x=-0.03, deliberately just short
const STATION=-0.68;    // cyan -> x=-0.34

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
  home:{ yellow:body(1,0),cyan:body(1,0),...OPEN },

  fake:{ yellow:body(0.54,0),cyan:body(1,0),...OPEN },
  near:{ yellow:body(1,0),cyan:body(1,NEAR),...OPEN },

  firstSwitch:{ yellow:body(1,SAFE),cyan:body(1,STATION),...OPEN },
  firstTrap:{ yellow:body(1,SAFE),cyan:body(0.54,STATION),...CLOSED },
  firstRelease:{ yellow:body(1,SAFE),cyan:body(1,STATION),...OPEN },

  // Second attempt: cyan refuses to complete the familiar path.
  secondSwitch:{ yellow:body(1,SAFE),cyan:body(1,NEAR),...OPEN },
  emptyClose:{ yellow:body(1,SAFE),cyan:body(1,NEAR),...CLOSED },
  emptyOpen:{ yellow:body(1,SAFE),cyan:body(1,NEAR),...OPEN },

  // Borrow the other character's old punctuation.
  cyanPunctuation:{ yellow:body(1,SAFE),cyan:body(1.10,NEAR),...OPEN },

  end:{ yellow:body(1,SAFE),cyan:body(1,0),...OPEN },
};

const doc={
  name:'stubborn-circle-gag-02',
  v:2,w:900,hpx:600,style:'flat',dw:1,
  pal:{YELLOW:'#F4C542',CYAN:'#6CC8C2',PRESS:'#62758A'},
  poses,
  plan:[
    {pose:'home',t:0.00},{pose:'home',t:0.20},

    // First trap.
    {pose:'fake',t:0.42},{pose:'fake',t:0.60},
    {pose:'home',t:0.74},
    {pose:'near',t:0.94},{pose:'near',t:1.08},
    {pose:'firstSwitch',t:1.32},{pose:'firstSwitch',t:1.44},
    {pose:'firstTrap',t:1.64},{pose:'firstTrap',t:1.82},
    {pose:'firstRelease',t:1.98},{pose:'firstRelease',t:2.14},

    // Reset the board.
    {pose:'home',t:2.38},{pose:'home',t:2.60},

    // Same counterfeit cue, same invitation.
    {pose:'fake',t:2.82},{pose:'fake',t:3.00},
    {pose:'home',t:3.14},
    {pose:'near',t:3.34},{pose:'near',t:3.50},

    // Yellow commits to the exact same exit. Cyan does not finish the trip.
    {pose:'secondSwitch',t:3.74},{pose:'secondSwitch',t:3.90},

    // Same press timing; this time nobody is there.
    {pose:'emptyClose',t:4.10},{pose:'emptyClose',t:4.28},
    {pose:'emptyOpen',t:4.44},{pose:'emptyOpen',t:4.62},

    // Tiny borrowed beat.
    {pose:'cyanPunctuation',t:4.80},
    {pose:'emptyOpen',t:4.96},
    {pose:'emptyOpen',t:5.20},
    {pose:'end',t:5.46},{pose:'end',t:5.68},
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
if(info.formatVersion!==1) throw new Error('gag 02 must exercise binary v1');

const BOX=[-0.88,0.13,0.70,0.87];
const W=760,H=360;
const fps=18,t0=0.08,t1=5.72;
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

const gifOut=path.join(HERE,'gag-02.gif');
fs.writeFileSync(gifOut,encodeGIF(frames,W,H,{delay:Math.round(100/fps),loop:0}));

// Diagnostic still: second press closes; cyan is visibly short of the station.
const stillT=4.20;
const still=canvasOf(W,H);
const b=K.build(stillT);
drawCel(still,W,0,0,W,H,K.meshView(),K.idxView(),b.stride,BOX,K.groupsView());
const pngOut=path.join(HERE,'gag-02.png');
fs.writeFileSync(pngOut,encodePNG(still,W,H));

console.log(JSON.stringify({
  gif:gifOut,png:pngOut,
  kind:'callback gag experiment',
  question:'Can a repeated trap make stopping short read as learned distrust?',
  ceiling:header.maxVerts,
  frames:n,fps,
},null,2));
