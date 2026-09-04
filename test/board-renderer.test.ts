import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { BoardRenderer } from '../public/games/insidia/ui/board-renderer.js';
import { boardLayout, activeNeighbor } from '../public/games/insidia/ui/board-layout.js';
import { conspiracies, sins } from '../public/games/insidia/ui/strings.js';

function view(count=6) {
  return {roomId:'room-1',stateVersion:1,public:{room:{status:'active'},turn:{turnNumber:1,phase:'action',activePlayerId:'p0'},board:{soulBank:20,sinDeckCount:16,conspiracyDeckCount:6,publicCenter:[],revealedConspiracy:null},players:Array.from({length:count},(_,i)=>({playerId:`p${i}`,seatIndex:i,displayName:'Un nombre español largo',status:'active',connected:true,souls:2,handCount:2,faceUpSins:i===1?[{sin:'RABIA'},{sin:'GULA'}]:[]})),recentEffects:[]},self:{playerId:'p0',legalActions:[],hand:Object.keys(sins).slice(0,4).map((sin,i)=>({sin,handCardRef:`ref${i}`}))}} as any;
}
function overlap(a:any,b:any) {return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;}
for(const [width,height] of [[1440,900],[1280,720],[1024,768],[844,390]]){
  for(const count of [3,4,5,6])test(`${count} seats at ${width}×${height}: zones and four hand cards never collide`,()=>{
    const v=view(count),l=boardLayout(width,height,v),regions=[...l.seats,...l.hand,l.decision];
    for(let i=0;i<regions.length;i++){
      const r=regions[i];assert(r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height,JSON.stringify(r));
      for(let j=i+1;j<regions.length;j++)assert(!overlap(r,regions[j]),`${i}/${j} overlap`);
    }
    assert.equal(l.seats.at(-1)?.playerId,'p0');
    assert.deepEqual(l.seats.slice(0,-1).map(s=>s.playerId),Array.from({length:count-1},(_,i)=>`p${i+1}`));
    for(const card of l.hand)assert(Math.abs(card.w*7-card.h*5)<1e-8);
    for(const seat of l.seats.filter(s=>s.playerId!=='p0'))assert(!overlap(seat,l.stage),'resolution stage is reserved');
    const before=l.seats.map(s=>[s.playerId,s.x,s.y]);v.public.players[1].status='eliminated';
    assert.deepEqual(boardLayout(width,height,v).seats.map(s=>[s.playerId,s.x,s.y]),before);
  });
}
test('viewer rotation uses stored seat order and Herejía skips eliminated neighbors',()=>{
  const v=view();v.self.playerId='p3';v.public.players[4].status='eliminated';
  assert.deepEqual(boardLayout(1440,900,v).seats.map(s=>s.playerId),['p4','p5','p0','p1','p2','p3']);
  assert.equal(activeNeighbor(v,'p3','right'),'p5');assert.equal(activeNeighbor(v,'p3','left'),'p2');
});
function rendererFixture() {
  const texts:string[]=[],images:any[]=[];
  const ctx:any={beginPath(){},roundRect(){},fill(){},stroke(){},clip(){},save(){},restore(){},moveTo(){},lineTo(){},closePath(){},arc(){},ellipse(){},rect(){},strokeRect(){},fillRect(){},createLinearGradient(){return {addColorStop(){}};},fillText(s:string){texts.push(s);},measureText(s:string){return {width:s.length*7};},drawImage(data:any,_sx:number,_sy:number,_sw:number,_sh:number,x:number,y:number,w:number,h:number){images.push({kind:data.kind,x,y,w,h});}};
  const image=(kind:string)=>({loaded:true,data:{kind},width:700,height:1000,getSourceRect(){return{x:0,y:0,width:700,height:1000};}});
  const v=view(),store:any={view:v,connected:true,now:()=>0,presentation:{reveals:[],cues:[],reducedMotion:false}};
  const ui={render(){},hide(){},destroy(){},selected:[],selectedTarget:null,interaction:{state(){return {state:'idle'};}}};
  const renderer=new BoardRenderer(store,{}, {},{pecadoBack:image('back'),pecadoFronts:Object.fromEntries(Object.keys(sins).map(s=>[s,image(s)])),conspiracyFronts:Object.fromEntries(Object.keys(conspiracies).map(s=>[s,image(s)]))},()=>ui);
  renderer.resize(1440,900);renderer.update();
  return {renderer,store,texts,images,draw(){texts.length=images.length=0;renderer.draw(ctx);}};
}
test('conspiracy art preserves landscape ratio and resources remain visible with two holds',()=>{
  const f=rendererFixture();f.store.presentation.reveals=[{conspiracy:'HEREJIA',current:true},{conspiracy:'PERFIDIA',current:false}];f.draw();
  assert(f.texts.some(t=>t.includes('Banco · 20')));assert(f.texts.includes('16 pecados'));assert(f.texts.includes('6 conspiraciones'));
  for(const key of ['HEREJIA','PERFIDIA']){const art=f.images.find(i=>i.kind===key);assert(art);assert(Math.abs(art.w*5-art.h*7)<1e-8);}
});
test('exposures are public thumbnails; disconnect and result never draw private hand fronts',()=>{
  const f=rendererFixture();f.draw();assert.equal(f.images.filter(i=>i.kind==='RABIA').length,2);
  f.store.connected=false;f.draw();assert.equal(f.images.filter(i=>i.kind==='back'&&f.renderer.layout.hand.some(c=>c.x===i.x&&c.y===i.y)).length,4);assert.equal(f.images.filter(i=>i.kind==='ORGULLO').length,0);
  f.store.connected=true;f.store.view.public.room.status='finished';f.draw();assert.equal(f.images.filter(i=>i.kind==='ORGULLO').length,0);
});
test('missing art keeps public name and resource information readable',()=>{
  const f=rendererFixture();f.renderer.cardAssets.conspiracyFronts={};f.store.presentation.reveals=[{conspiracy:'INDIGENCIA',current:true}];f.draw();assert(f.texts.includes('Indigencia'));assert(f.texts.some(t=>t.includes('Banco')));
});
test('drawing does not expire reveals, reset selection, or mutate accepted authority',()=>{
  const f=rendererFixture(),v=JSON.stringify(f.store.view);f.store.presentation.reveals=[{conspiracy:'HEREJIA',current:true}];const reveal=JSON.stringify(f.store.presentation.reveals);f.draw();f.draw();assert.equal(JSON.stringify(f.store.view),v);assert.equal(JSON.stringify(f.store.presentation.reveals),reveal);
});
test('all illustrated conspiracy fronts retain the expected source dimensions',async()=>{
  await Promise.all(Object.keys(conspiracies).map(async name=>{const path=fileURLToPath(new URL(`../public/games/insidia/media/conspiraciones/${name.toLowerCase()}.webp`,import.meta.url)),m=await sharp(path).metadata();assert.equal(m.width,1024);assert.equal(m.height,732);}));
});

test('landscape safe areas preserve hand hits and keep decisions inside the cutout-free viewport',()=>{
  const l=boardLayout(844,390,view(),{left:47,right:47,bottom:21});
  const regions=[...l.seats,...l.hand,l.decision];
  for(const r of regions){assert(r.x>=47);assert(r.x+r.w<=797);assert(r.y+r.h<=369);}
  for(const c of l.hand)assert(c.h>=96,'body and inspector each retain44px plus8px gap');
});

test('actual reveal art stays above resources and inside its reserved stage at every viewport',()=>{
  for(const [w,h] of [[1440,900],[1280,720],[1024,768],[844,390]]){
    const f=rendererFixture();f.renderer.resize(w,h);f.renderer.update();f.store.presentation.reveals=[{conspiracy:'HEREJIA',current:true},{conspiracy:'PERFIDIA',current:false}];f.draw();
    for(const art of f.images.filter(i=>['HEREJIA','PERFIDIA'].includes(i.kind))){assert(art.y+art.h<=f.renderer.layout.stage.y+f.renderer.layout.stage.h);assert(art.y+art.h<f.renderer.layout.resources.y);}
  }
});
test('sanitized reconnect authority freezes anonymous hand slots with no old reference',()=>{
  const f=rendererFixture();f.store.connected=false;f.store.view.self.hand=[];f.renderer.update();f.draw();
  assert.equal(f.renderer.layout.hand.length,2);
  assert(f.renderer.layout.hand.every(c=>!c.sin&&!c.handCardRef));
  assert.equal(f.images.filter(i=>i.kind==='back'&&f.renderer.layout.hand.some(c=>c.x===i.x&&c.y===i.y)).length,2);
  f.store.view=null;f.renderer.update();assert.equal(f.renderer.layout,null);
});
