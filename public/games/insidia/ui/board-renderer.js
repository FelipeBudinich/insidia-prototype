import { sins, conspiracies, effectText } from './strings.js';
import { assets } from '../media/assets.js';
import { drawImageAsset } from './card-art.js';
import { boardLayout, activeNeighbor } from './board-layout.js';
import { PremiumInterface } from './premium-interface.js';

const P = { bg: '#16151b', panel: '#211e28', line: '#413846', gold: '#d2b478', ink: '#eee7da', muted: '#b5aaba', green: '#93b6a0', red: '#e49b91' };
const point = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// Drawing samples established authority/presentation. Input and all lifecycle
// changes happen in update(), including semantic controls and scoped selection.
export class BoardRenderer {
  constructor(store, dispatch, home, cardAssets = assets, interfaceFactory = (s,d,h) => new PremiumInterface(s,d,h)) {
    this.store = store;
    this.dispatch = dispatch;
    this.home = home;
    this.cardAssets = cardAssets;
    this.width = 1600;
    this.height = 900;
    this.ui = interfaceFactory(store, dispatch, home);
    this.layout = null;
    this.surface = null;
    this.wrapCache = new Map();
    this.regions = [];
  }
  resize(width, height) {
    this.width = width;
    this.height = height;
    this.surface = null;
    const styles=globalThis.getComputedStyle?.(document.documentElement);
    this.insets=Object.fromEntries(['left','right','top','bottom'].map(side=>[side,parseFloat(styles?.getPropertyValue('--safe-'+side))||0]));
    this.wrapCache.clear();
    this.layout = boardLayout(width, height, this.store.view, this.insets);
  }
  update() {
    const v = this.store.view;
    if (!v || !['active', 'finished'].includes(v.public.room.status)) {
      this.ui.hide();
      this.layout = null;
      this.regions = [];
      return;
    }
    this.layout = boardLayout(this.width, this.height, v, this.insets);
    if (!this.store.presentation?.reducedMotion && (!v.public.turn.deadline || Date.parse(v.public.turn.deadline)-this.store.now()>5000)) {
      for (const card of this.layout.hand) {
        const state=this.ui.interaction?.state('hand:'+card.handCardRef);
        if(state?.hovered || state?.focused || state?.selected) card.y-=6;
      }
    }
    this.ui.render(this.layout);
  }
  destroy() { this.ui.destroy(); this.surface = null; this.wrapCache.clear(); }
  rect(x,y,w,h,fill,stroke,r=8) {
    if (w <= 0 || h <= 0) return;
    const c=this.ctx;
    c.beginPath(); c.roundRect(x,y,w,h,r);
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  }
  text(value,x,y,size=16,color=P.ink,align='left',serif=false) {
    const c=this.ctx;
    c.font=`${size}px ${serif?'Georgia, serif':'Arial, sans-serif'}`;
    c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;
    c.fillText(String(value),x,y);
  }
  wrap(value,x,y,width,size=14,color=P.muted,line=20,align='left') {
    const key=[value,width,size].join('|');
    let rows=this.wrapCache.get(key);
    if(!rows){
      rows=[];let row='';this.ctx.font=`${size}px Arial, sans-serif`;
      for(const word of String(value).split(' ')){
        if(row && this.ctx.measureText(row+' '+word).width>width){rows.push(row);row='';}
        row+=(row?' ':'')+word;
      }
      if(row)rows.push(row);
      if(this.wrapCache.size>400)this.wrapCache.clear();
      this.wrapCache.set(key,rows);
    }
    rows.forEach((row,i)=>this.text(row,x,y+i*line,size,color,align));
    return rows.length*line;
  }
  card(sin,x,y,w,{back=false,selected=false,exposed=false,order,small=false}={}) {
    const h=w*7/5,c=this.ctx,s=sins[sin], color=selected?P.gold:(s?.color??'#807051');
    this.rect(x,y,w,h,back?'#25212c':exposed?'#302326':'#2b2631',color,6);
    const image=back?this.cardAssets.pecadoBack:this.cardAssets.pecadoFronts?.[sin];
    const loaded=drawImageAsset(c,image,x,y,w,h,6);
    if(!loaded){
      this.text(back?'I':s?.symbol??'?',x+w/2,y+h*.4,Math.max(18,w*.32),color,'center',true);
    }
    if(!back && !small){
      const gradient=c.createLinearGradient(x,y+h*.62,x,y+h);
      gradient.addColorStop(0,'#100c1500');gradient.addColorStop(1,'#100c15f5');
      c.fillStyle=gradient;c.fillRect(x,y+h*.62,w,h*.38);
      this.text(s?.name??'Pecado',x+w/2,y+h-60,Math.min(17,Math.max(12,w*.17)),P.ink,'center',true);
      this.rect(x+5,y+5,Math.min(w-10,48),22,'#17131ddd',null,4);
      this.text(`${s?.cost??0} ◇`,x+10,y+16,12,P.gold);
    }
    this.rect(x,y,w,h,null,color,6);
    if(selected){
      c.lineWidth=2;c.strokeStyle=P.gold;c.strokeRect?.(x-2,y-2,w+4,h+4);
      this.rect(x+w-26,y-5,28,26,P.gold,null,13);
      this.text(order??'✓',x+w-12,y+8,14,P.bg,'center');
    }
    return {x,y,w,h};
  }
  conspiracyCard(x,y,w,conspiracy=null) {
    const h=w*5/7,c=this.ctx;
    this.rect(x,y,w,h,'#29212d','#74566c',6);
    const loaded=drawImageAsset(c,conspiracy?this.cardAssets.conspiracyFronts?.[conspiracy]:this.cardAssets.conspiracyBack,x,y,w,h,6,'cover');
    if(!loaded)this.text('✧',x+w/2,y+h*.38,Math.min(54,w*.28),P.gold,'center',true);
    if(conspiracy){
      this.rect(x,y+h-34,w,34,'#130f1bed',null,4);
      this.text(conspiracies[conspiracy]?.[0]??'Conspiración',x+w/2,y+h-17,Math.min(19,Math.max(14,w*.085)),P.ink,'center',true);
    }
    this.rect(x,y,w,h,null,P.gold,6);
    return {x,y,w,h};
  }
  staticTable() {
    const {width:w,height:h,tableWidth,handTop}=this.layout,c=this.ctx;
    if(!this.surface && typeof document!=='undefined'){
      const surface=document.createElement('canvas');
      if(surface.getContext){
        const dpr=Math.min(2,globalThis.devicePixelRatio||1);
        surface.width=Math.round(w*dpr);surface.height=Math.round(h*dpr);
        const target=surface.getContext('2d');
        if(target){
          target.scale(dpr,dpr);target.fillStyle=P.bg;target.fillRect(0,0,w,h);
          const g=target.createRadialGradient(tableWidth/2,handTop*.48,10,tableWidth/2,handTop*.48,tableWidth*.7);
          g.addColorStop(0,'#302632');g.addColorStop(1,P.bg);target.fillStyle=g;target.fillRect(0,52,tableWidth,handTop-52);
          target.strokeStyle='#a88a5033';target.lineWidth=1;
          for(const inset of [0,8]){
            target.beginPath();target.ellipse(tableWidth/2,handTop*.53,Math.max(40,tableWidth*.43-inset),Math.max(35,handTop*.34-inset),0,0,Math.PI*2);target.stroke();
          }
          target.fillStyle=P.line;target.fillRect(12,handTop-4,tableWidth-24,1);
          target.fillStyle='#17141cdf';target.fillRect(tableWidth+10,56,w-tableWidth-10,h-56);
          this.surface=surface;
        }
      }
    }
    if(this.surface)c.drawImage(this.surface,0,0,w,h);
    else {c.fillStyle=P.bg;c.fillRect(0,0,w,h);}
  }
  playerPanel(player,seat) {
    const {x,y,w,h}=seat,v=this.store.view;
    const active=player.playerId===v.public.turn.activePlayerId;
    const responder=player.playerId===v.public.interaction?.currentResponderId || player.playerId===v.public.interaction?.playerId;
    const selected=this.ui.selectedTarget===player.playerId;
    const eliminated=player.status==='eliminated';
    this.rect(x,y,w,h,eliminated?'#1a181e':P.panel,selected?P.green:responder?P.red:active?P.gold:P.line,7);
    if(active||responder||selected){
      this.rect(x,y,3,h,selected?P.green:responder?P.red:P.gold,null,2);
    }
    const name=player.displayName;
    this.ctx.save();this.ctx.beginPath();this.ctx.rect?.(x+8,y+2,w-16,28);this.ctx.clip();
    this.text(name,x+10,y+17,this.layout.short?14:18,eliminated?P.muted:P.ink,'left',true);this.ctx.restore();
    this.text(w<100?`${player.souls} ◇`:`${player.souls} ◇ · ${player.handCount} cartas`,x+10,y+39,14,P.gold);
    let label=eliminated?'Eliminado':player.faceUpSins.length>=2?'Eliminación pendiente':responder?'Responde':active?'Turno':!player.connected?'Desconectado':player.kind==='bot'?'Bot':'En la mesa';
    if(seat===this.layout.local && !eliminated && !responder && !active)label='Tu alma';
    if(!player.faceUpSins.length && seat!==this.layout.local){
      for(let i=0;i<Math.min(4,player.handCount);i++)this.card(null,x+w-18-(i+1)*16,y+h-32,15,{back:true,small:true});
    }
    const available=w-(player.faceUpSins.length?player.faceUpSins.length*(this.layout.short?28:38):0)-20;
    this.wrap(label,x+10,y+61,Math.max(45,available),12,eliminated?P.muted:responder?P.red:P.muted,15);
  }
  anchor(location) {
    const l=this.layout;
    if(location?.zone==='seat' || location?.zone==='exposure'){
      const seat=l.seats.find(s=>s.playerId===location.playerId);
      if(seat)return location.zone==='exposure'?{x:seat.x+seat.w-28,y:seat.y+seat.h-24}:point(seat);
    }
    return l.anchors[location?.zone]??l.anchors.stage;
  }
  connection(from,to,progress,color=P.gold) {
    const c=this.ctx;c.save();c.strokeStyle=color+'88';c.lineWidth=2;c.beginPath();c.moveTo(from.x,from.y);c.lineTo(to.x,to.y);c.stroke();
    const t=1-Math.pow(1-progress,3),x=from.x+(to.x-from.x)*t,y=from.y+(to.y-from.y)*t-Math.sin(Math.PI*t)*18;
    c.fillStyle=color;c.beginPath();c.arc(x,y,6,0,Math.PI*2);c.fill();c.restore();
    return {x,y};
  }
  drawCues() {
    const director=this.store.presentation;
    if(!director || !this.store.connected)return;
    const cues=director.cues.slice(-24);
    const urgent=this.store.view.public.turn.deadline && Date.parse(this.store.view.public.turn.deadline)-this.store.now()<5000;
    let spriteBudget=24;
    for(const cue of cues){
      if(spriteBudget--<=0)break;
      const e=cue.effect??cue.permittedVisual??{},p=cue.progress??1;
      const source=this.anchor(cue.source),destination=this.anchor(cue.destination);
      const reduced=director.reducedMotion||urgent;
      if(cue.kind==='transferSouls'){
        if(!reduced && e.amount>0)this.connection(source,destination,p);
        const minus=e.kind==='soulsPaid';
        this.text(`${minus?'−':'+'}${e.amount??0} ◇`,minus?source.x:destination.x,minus?source.y-30:destination.y-30,20,P.gold,'center');
        if(e.kind==='soulsStolen')this.text(`−${e.amount} ◇`,source.x,source.y-30,20,P.red,'center');
      }else if(cue.kind==='declareClaim'){
        // Reference emblem only: no hand origin and no card instance.
        const loc=reduced?destination:this.connection(source,destination,p,sins[e.sin]?.color??P.gold);
        this.rect(loc.x-28,loc.y-28,56,56,'#2f2635',P.gold,28);
        this.text(sins[e.sin]?.symbol??'◇',loc.x,loc.y,29,P.gold,'center',true);
      }else if(['showProof','exposeSin'].includes(cue.kind)&&e.sin){
        const w=this.layout.short?42:72;
        this.card(e.sin,destination.x-w/2,destination.y-w*.7,w,{exposed:true,small:true});
        this.text(cue.kind==='showProof'?'Demostrado':'Revelado',destination.x,destination.y+w*.7+14,14,P.gold,'center');
      }else if(['exchangeAnonymousCards','rotateCards','eliminateGroup'].includes(cue.kind)){
        const wholeTable=cue.kind==='rotateCards'||['handsShuffled','gameStarted'].includes(e.kind);
        const group=cue.permittedVisual?.playerIds??[e.actorPlayerId];
        if(wholeTable && cue.permittedVisual?.generic){
          const deck=this.layout.anchors.deck;
          this.card(null,deck.x-17,deck.y-24,34,{back:true});
          this.text(e.kind==='cardsRotated'?'Intercambio simultáneo':'Manos mezcladas',this.layout.anchors.stage.x,this.layout.anchors.stage.y+28,14,P.gold,'center');
          continue;
        }
        const sources=wholeTable && cue.permittedVisual?.playerIds?this.layout.seats.filter(seat=>group.includes(seat.playerId)):wholeTable?this.layout.seats.filter(s=>this.store.view.public.players.find(p=>p.playerId===s.playerId)?.status!=='eliminated'):this.layout.seats.filter(s=>group.includes(s.playerId));
        for(const seat of sources){
          if(spriteBudget--<=0)break;
          let start=e.kind==='sinForgiven'?source:point(seat),end=destination,travel=p;
          const deck=this.layout.anchors.deck;
          if(e.kind==='gameStarted'){start=deck;end=point(seat);}
          else if(cue.kind==='eliminateGroup'){
            end=deck;
            this.rect(seat.x-2,seat.y-2,seat.w+4,seat.h+4,null,P.red,8);
          }else if(cue.kind==='rotateCards'){
            const roster=cue.permittedVisual?.playerIds;
            const index=roster?.indexOf(seat.playerId);
            const id=roster?roster[(index+(e.direction==='right'?1:roster.length-1))%roster.length]:activeNeighbor(this.store.view,seat.playerId,e.direction);
            const target=this.layout.seats.find(s=>s.playerId===id);if(target)end=point(target);
          }else if(e.kind==='handsShuffled'){
            // The gather ends before a separate anonymous refill stream. No
            // card/ref survives the deck midpoint or determines a recipient.
            if(p<.45){end=deck;travel=p/.45;}
            else if(p>.55){start=deck;end=point(seat);travel=(p-.55)/.45;}
            else continue;
          }
          if(!reduced){const loc=this.connection(start,end,travel,P.muted);this.card(null,loc.x-13,loc.y-18,26,{back:true});}
        }
      }else if(cue.kind==='advanceDecision'){
        const pos=e.kind==='targetSelected'?this.anchor({zone:'seat',playerId:e.targetPlayerId}):source;
        this.text(e.kind==='challengePassed'?'Pasa':'Objetivo',pos.x,pos.y+22,14,P.gold,'center');
      }else if(cue.kind==='showChallenge'){if(!reduced)this.connection(source,destination,p,P.red);this.text('Desafío',source.x,source.y+22,14,P.red,'center');}
      else if(cue.kind==='showResult'){
        const stage=this.layout.stage,result=this.store.view.public.result;
        const winner=this.store.view.public.players.find(player=>player.playerId===result?.winnerPlayerId);
        this.rect(stage.x-8,stage.y+18,stage.w+16,104,'#2c2233',P.gold,10);
        this.text(winner?'♛':'◇',stage.x+stage.w/2,stage.y+50,32,P.gold,'center',true);
        this.wrap(winner?`${winner.displayName} gana`:result?.endReason==='draw'?'Nadie queda en pie':'El pacto ha terminado',stage.x+stage.w/2,stage.y+90,stage.w-12,18,P.gold,22,'center');
      }
      else if(cue.kind==='blockClaim'){
        const s=this.layout.stage;this.rect(s.x,s.y+s.h/2-20,s.w,40,'#342b30',P.red,5);this.text('Bloqueado',s.x+s.w/2,s.y+s.h/2,18,P.red,'center');
      }
    }
  }
  draw(ctx) {
    const v=this.store.view;
    if(!v || !['active','finished'].includes(v.public.room.status))return;
    this.ctx=ctx;
    const l=this.layout??boardLayout(this.width,this.height,v);
    this.layout=l;
    this.staticTable();
    const pub=v.public;
    for(const seat of l.seats){const p=pub.players.find(p=>p.playerId===seat.playerId);if(p)this.playerPanel(p,seat);}
    for(const card of l.exposure)this.card(card.sin,card.x,card.y,card.w,{small:true,exposed:true});
    if(!l.short && l.height >= 850){
      const deckY=l.handTop-166,center=l.tableWidth/2;
      this.card(null,center-180,deckY,76,{back:true});
      this.conspiracyCard(center+98,deckY+18,106);
      this.text('EL BANCO',center,deckY+22,12,P.muted,'center');
      this.text(pub.board.soulBank,center,deckY+62,38,P.gold,'center',true);
      this.text('ALMAS',center,deckY+94,12,P.gold,'center');
    }
    const r=l.resources;
    this.text(`${pub.board.sinDeckCount} pecados`,r.x,r.y+12,14,P.muted);
    this.text(`Banco · ${pub.board.soulBank} ◇`,l.tableWidth/2,r.y+12,16,P.gold,'center');
    this.text(`${pub.board.conspiracyDeckCount} conspiraciones`,r.x+r.w,r.y+12,14,P.muted,'right');
    const s=l.stage;
    let reveals=this.store.presentation?.reveals??[];
    if(!reveals.length && pub.board.revealedConspiracy)reveals=[{conspiracy:pub.board.revealedConspiracy.conspiracy,current:true}];
    if(reveals.length){
      const gap=8,w=Math.min((s.w-(reveals.length-1)*gap)/reveals.length, (s.h-(l.short?28:50))*7/5,l.short?(l.height<380?70:84):240);
      reveals.forEach((reveal,i)=>{
        const x=s.x+(s.w-(w*reveals.length+gap*(reveals.length-1)))/2+i*(w+gap);
        this.conspiracyCard(x,s.y+18,w,reveal.conspiracy??reveal.card.conspiracy);
        this.text(reveal.current?'En resolución':'Revelada',x+w/2,s.y+7,12,P.gold,'center');
      });
    }else{
      const c=s.w/2+ s.x;
      this.text('INSIDIA',c,s.y+s.h*.37,l.short?19:34,'#a58b65','center',true);
      if(!l.short)this.text('LA VERDAD ES OPCIONAL',c,s.y+s.h*.37+31,12,P.muted,'center');
    }
    const claim=pub.interaction?.declaredSin??pub.board.resolvingSin?.sin??this.store.presentation?.claimContext?.sin;
    if(claim && !l.short){
      const text=(pub.board.resolvingSin?'Demostrado · ':'Declara · ')+sins[claim].name;
      this.text(text,s.x+s.w/2,s.y+s.h-(l.short?0:8),14,sins[claim].color,'center');
    }
    if(pub.board.publicCenter.length && !l.short){
      this.text(`${pub.board.publicCenter.length} pecados públicos · ver historial`,s.x+s.w/2,l.resources.y-20,12,P.muted,'center');
    }
    const privateVisible=this.store.connected && !this.store.reconnecting && pub.room.status==='active';
    for(const card of l.hand){
      const selected=this.ui.selected?.includes(card.handCardRef),state=this.ui.interaction?.state('hand:'+card.handCardRef)?.state;
      this.card(privateVisible?card.sin:null,card.x,card.y,card.w,{back:!privateVisible||!card.sin,selected:privateVisible&&selected,order:selected?this.ui.selected.indexOf(card.handCardRef)+1:undefined});
      if(privateVisible && ['hovered','focused','pressed'].includes(state))this.rect(card.x-3,card.y-3,card.w+6,card.h+6,null,P.gold,7);
    }
    if(this.ui.selectedTarget){
      const target=l.seats.find(s=>s.playerId===this.ui.selectedTarget);
      if(target){const from=point(l.local),to=point(target);ctx.save();ctx.strokeStyle=P.green;ctx.lineWidth=2;ctx.setLineDash?.([5,5]);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();ctx.restore();}
    }
    if(this.ui.selectedDirection){
      const neighbor=activeNeighbor(v,v.self.playerId,this.ui.selectedDirection);
      const target=l.seats.find(seat=>seat.playerId===neighbor);
      if(target){const a=point(l.local),b=point(target);this.connection(a,b,1,P.green);this.text(this.ui.selectedDirection==='right'?'Derecha →':'← Izquierda',(a.x+b.x)/2,(a.y+b.y)/2-16,14,P.green,'center');}
    }
    this.drawCues();
    if(!this.store.connected){ctx.fillStyle='#0e0b1470';ctx.fillRect(0,0,l.width,l.height);}
  }
}
