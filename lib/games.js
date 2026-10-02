import { randomBytes, randomInt } from 'node:crypto';
import { Chess } from 'chess.js';

export const TIME_CONTROLS = Object.freeze({
  bullet: { initial:60000, increment:0, label:'Bullet · 1+0' },
  blitz: { initial:180000, increment:2000, label:'Blitz · 3+2' },
  rapid: { initial:600000, increment:0, label:'Rápidas · 10+0' },
});

/** Material-based impossibility: includes the opposing pieces that can block escape squares. */
export function insufficientToMate(chess, color) {
  const all=chess.board().flat().filter(Boolean),own=all.filter(p=>p.color===color);
  if(own.some(p=>['p','q','r'].includes(p.type)))return false;
  if(own.some(p=>p.type==='n'))return own.length===2&&!all.some(p=>p.color!==color&&['p','n','b','r'].includes(p.type));
  if(own.some(p=>p.type==='b')) {
    const shades=new Set(all.filter(p=>p.type==='b').map(p=>(p.square.charCodeAt(0)+Number(p.square[1]))%2));
    return shades.size===1&&!all.some(p=>p.type==='p'||p.type==='n');
  }
  return true;
}

export const BOT_LEVELS=Object.freeze({easy:{name:'Royal · Fácil',skill:0,nodes:3000},medium:{name:'Royal · Medio',skill:8,nodes:20000},hard:{name:'Royal · Difícil',skill:16,nodes:100000}});

export function createGames(db,{now=Date.now,notify=()=>{},attach=()=>{},onFinished=()=>{},botMove=null}={}) {
  const queue=new Map(),engines=new Map(),thinking=new Map();let stopped=false;
  const get=id=>db.prepare('SELECT * FROM games WHERE id=?').get(id);
  const person=(id,mode)=>{
    if(!id)return null;
    const u=db.prepare('SELECT id,name,rating,points,played FROM users WHERE id=?').get(id);
    if(mode&&u)u.rating=rating(id,mode).rating;
    return u;
  };
  function rating(uid,mode){
    db.prepare('INSERT OR IGNORE INTO mode_ratings(user,mode) VALUES(?,?)').run(uid,mode);
    return db.prepare('SELECT rating,played FROM mode_ratings WHERE user=? AND mode=?').get(uid,mode);
  }
  function engine(g){
    if(engines.has(g.id))return engines.get(g.id);
    const c=new Chess();if(g.pgn)c.loadPgn(g.pgn);
    if(g.status==='active')engines.set(g.id,c);
    return c;
  }
  function open(uid){return db.prepare("SELECT id FROM games WHERE (white=? OR black=? OR created_by=?) AND status IN ('waiting','active') LIMIT 1").get(uid,uid,uid);}
  function idle(uid){if(open(uid)||queue.has(uid))throw Error('Ya tienes una partida o búsqueda abierta.');}
  function clocks(g,t=now()){
    if(g.white_ms==null)return null;
    const clocks={white:g.white_ms,black:g.black_ms};
    if(g.status==='active'&&g.turn_since!=null){const side=engine(g).turn()==='w'?'white':'black';clocks[side]=Math.max(0,clocks[side]-Math.max(0,t-g.turn_since));}
    return {...clocks,serverNow:t,running:g.status==='active'?engine(g).turn():null,increment:TIME_CONTROLS[g.mode]?.increment||0};
  }
  function state(g){
    const c=engine(g),history=c.history({verbose:true}),last=history.at(-1),captured={w:[],b:[]};
    for(const move of history)if(move.captured)captured[move.color].push(move.captured);
    return {id:g.id,version:g.version,kind:g.kind,mode:g.mode,rated:Boolean(g.rated),botLevel:g.bot_level,botThinking:thinking.has(g.id),botError:g.bot_error,white:person(g.white,g.mode),black:person(g.black,g.mode),status:g.status,result:g.result,reason:g.reason,offer:g.offer,rematchOffer:g.rematch_offer,fen:c.fen(),board:c.board(),turn:c.turn(),check:c.isCheck(),moves:c.history(),captured,legal:g.status==='active'?c.moves({verbose:true}).map(m=>({from:m.from,to:m.to,promotion:m.promotion})):[],lastMove:last?[last.from,last.to]:[],clocks:clocks(g)};
  }
  function publish(id){const g=get(id);if(!g)return;notify([...new Set([g.white,g.black,g.created_by].filter(Boolean))],{type:'game',game:state(g)});}
  function allocate(){let id;do{id=randomBytes(3).toString('hex').toUpperCase();}while(get(id));return id;}
  function activate(id){const g=get(id),t=now(),initial=TIME_CONTROLS[g.mode]?.initial??null;db.prepare("UPDATE games SET status='active',started_at=?,turn_since=?,white_ms=?,black_ms=?,version=version+1 WHERE id=? AND status='waiting'").run(t,initial==null?null:t,initial,initial,id);}
  function finish(g,result,reason,clock=clocks(g)){
    if(g.status!=='active')throw Error('La partida no está activa.');
    const score=result==='1-0'?1:result==='0-1'?0:0.5;
    db.exec('BEGIN IMMEDIATE');
    try{
      const changed=db.prepare("UPDATE games SET status='finished',result=?,reason=?,offer=NULL,rematch_offer=NULL,finished=CURRENT_TIMESTAMP,white_ms=?,black_ms=?,turn_since=NULL,version=version+1 WHERE id=? AND status='active' AND version=?").run(result,reason,clock?.white??null,clock?.black??null,g.id,g.version);
      if(changed.changes!==1)throw Error('La partida ya cambió.');
      // User totals count games, while competitive Elo is isolated per time category.
      if(g.kind!=='bot')for(const [uid,points] of [[g.white,score],[g.black,1-score]])if(uid)db.prepare('UPDATE users SET points=points+?,played=played+1 WHERE id=?').run(points,uid);
      if(g.rated){
        const w=rating(g.white,g.mode),b=rating(g.black,g.mode),delta=Math.round(32*(score-1/(1+10**((b.rating-w.rating)/400))));
        for(const [uid,previous,d] of [[g.white,w.rating,delta],[g.black,b.rating,-delta]]){
          db.prepare('UPDATE mode_ratings SET rating=rating+?,played=played+1 WHERE user=? AND mode=?').run(d,uid,g.mode);
          db.prepare('INSERT INTO ratings VALUES(?,?,?,?)').run(g.id,uid,previous,previous+d);
        }
      }
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    engines.delete(g.id);onFinished(get(g.id));
  }
  function expired(g){
    if(g.status!=='active'||g.white_ms==null)return false;
    const time=clocks(g),c=engine(g),loser=c.turn(),remaining=loser==='w'?time.white:time.black;
    if(remaining>0)return false;
    const draw=insufficientToMate(c,loser==='w'?'b':'w');
    finish(g,draw?'1/2-1/2':loser==='w'?'0-1':'1-0',draw?'Tablas: rival sin material de mate':'Tiempo agotado',time);publish(g.id);return true;
  }
  function create(uid,m){
    idle(uid);const mode=m.mode||'rapid';if(!Object.hasOwn(TIME_CONTROLS,mode))throw Error('Ritmo inválido.');
    const color=m.color||'white';if(!['white','black','random'].includes(color))throw Error('Color inválido.');
    const white=color==='white'||(color==='random'&&randomInt(2)===0),id=allocate();
    db.prepare("INSERT INTO games(id,white,black,created_by,kind,mode) VALUES(?,?,?,?,'friend',?)").run(id,white?uid:null,white?null:uid,uid,mode);
    attach([uid],id);publish(id);return id;
  }
  function join(uid,m){
    idle(uid);const id=String(m.code||'').trim().toUpperCase(),g=get(id);
    if(!g||g.status!=='waiting'||g.created_by===uid||g.kind==='match')throw Error('La sala no está disponible.');
    const slot=g.white?'black':'white';
    db.prepare(`UPDATE games SET ${slot}=? WHERE id=? AND status='waiting'`).run(uid,id);
    activate(id);attach([g.created_by,uid],id);publish(id);return id;
  }
  function createBot(uid,m,source=null){
    idle(uid);if(!botMove)throw Error('El motor de computadora no está disponible.');
    const level=m.level||'easy';if(!Object.hasOwn(BOT_LEVELS,level))throw Error('Dificultad inválida.');
    const color=m.color||'white';if(!['white','black','random'].includes(color))throw Error('Color inválido.');
    const white=color==='white'||(color==='random'&&randomInt(2)===0),bot=`_bot_${level}`,id=allocate();
    db.prepare('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)').run(bot,BOT_LEVELS[level].name);
    db.prepare("INSERT INTO games(id,white,black,created_by,kind,bot_level,rematch_of) VALUES(?,?,? ,?,'bot',?,?)").run(id,white?uid:bot,white?bot:uid,uid,level,source);
    activate(id);attach([uid],id);publish(id);scheduleBot(id);return id;
  }
  function scheduleBot(id){
    if(stopped||thinking.has(id)||!botMove)return;
    const g=get(id);if(!g||g.kind!=='bot'||g.status!=='active'||g.bot_error)return;
    const c=engine(g),bot=g.white.startsWith('_bot_')?g.white:g.black,color=g.white===bot?'w':'b';
    if(c.turn()!==color)return;
    const job={version:g.version};thinking.set(id,job);publish(id);
    Promise.resolve().then(()=>botMove(c.fen(),BOT_LEVELS[g.bot_level])).then(result=>{
      if(stopped)return;
      const latest=get(id);if(!latest||latest.status!=='active'||latest.version!==job.version)return;
      const move=typeof result==='string'?result:result.move;
      if(!/^([a-h][1-8]){2}[qrbn]?$/.test(move||''))throw Error('Movimiento del motor inválido.');
      thinking.delete(id);
      handle(bot,{type:'move',id,version:latest.version,from:move.slice(0,2),to:move.slice(2,4),...(move[4]?{promotion:move[4]}:{})});
    }).catch(()=>{
      if(stopped)return;
      const latest=get(id);if(latest?.status==='active'&&latest.version===job.version)db.prepare('UPDATE games SET bot_error=? WHERE id=?').run('El motor se detuvo. Puedes reintentar o terminar la partida.',id);
    }).finally(()=>{if(thinking.get(id)===job)thinking.delete(id);if(!stopped)publish(id);});
  }
  function queueState(uid){const entry=queue.get(uid);return entry?{type:'queue',searching:true,mode:entry.mode,since:entry.since,range:200+100*Math.floor(Math.max(0,now()-entry.since)/15000)}:{type:'queue',searching:false};}
  function cancelSearch(uid,reason){if(queue.delete(uid))notify([uid],{type:'queue',searching:false,reason});}
  function match(){
    const entries=[...queue.entries()].sort((a,b)=>a[1].since-b[1].since);
    for(const [uid,a] of entries){
      if(!queue.has(uid))continue;
      const rival=entries.find(([other,b])=>other!==uid&&queue.has(other)&&a.mode===b.mode&&Math.abs(a.rating-b.rating)<=Math.min(queueState(uid).range,queueState(other).range));
      if(!rival)continue;
      const other=rival[0],white=randomInt(2)?uid:other,black=white===uid?other:uid,id=allocate();
      // Synchronous SQLite and the event loop serialize allocation and removing both queue entries.
      db.prepare("INSERT INTO games(id,white,black,created_by,kind,mode,rated) VALUES(?,?,? ,?,'match',?,1)").run(id,white,black,white,a.mode);
      queue.delete(uid);queue.delete(other);activate(id);attach([uid,other],id);notify([uid,other],{type:'queue',searching:false});publish(id);
    }
  }
  function handle(uid,m){
    if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.type!=='string')throw Error('Mensaje inválido.');
    if(m.type==='create')return create(uid,m);
    if(m.type==='join')return join(uid,m);
    if(m.type==='bot')return createBot(uid,m);
    if(m.type==='queue'){
      idle(uid);if(!Object.hasOwn(TIME_CONTROLS,m.mode))throw Error('Ritmo inválido.');
      queue.set(uid,{mode:m.mode,rating:rating(uid,m.mode).rating,since:now()});notify([uid],queueState(uid));match();return;
    }
    if(m.type==='queueCancel'){cancelSearch(uid);return;}
    if(typeof m.id!=='string'||!/^[A-F0-9]{6}$/.test(m.id))throw Error('Identificador de partida inválido.');
    const g=get(m.id);
    if(!g||![g.white,g.black,g.created_by].includes(uid))throw Error('No perteneces a esta partida.');
    if(!Number.isInteger(m.version)||m.version!==g.version){publish(g.id);throw Error('La partida cambió. Revisa el tablero antes de continuar.');}
    if(m.type==='cancel'&&g.status==='waiting'){
      if(g.created_by!==uid)throw Error('Solo el creador puede cerrar la sala.');
      db.prepare("UPDATE games SET status='cancelled',version=version+1 WHERE id=?").run(g.id);publish(g.id);return;
    }
    if(m.type==='rematch'&&g.status==='finished'){
      if(db.prepare('SELECT id FROM games WHERE rematch_of=?').get(g.id))throw Error('La revancha ya existe.');
      idle(uid);
      if(g.kind==='bot')return createBot(uid,{level:g.bot_level,color:g.white===uid?'black':'white'},g.id);
      if(g.rematch_offer&&g.rematch_offer!==uid){
        idle(g.rematch_offer);const id=allocate();
        db.prepare("INSERT INTO games(id,white,black,created_by,kind,mode,rated,rematch_of) VALUES(?,?,? ,?,'friend',?,0,?)").run(id,g.black,g.white,uid,g.mode||'rapid',g.id);
        activate(id);db.prepare('UPDATE games SET rematch_offer=NULL,version=version+1 WHERE id=?').run(g.id);attach([g.white,g.black],id);publish(id);return id;
      }
      if(g.rematch_offer===uid)throw Error('Ya ofreciste una revancha.');
      db.prepare('UPDATE games SET rematch_offer=?,version=version+1 WHERE id=?').run(uid,g.id);publish(g.id);return;
    }
    if(g.status!=='active')throw Error('La partida no está activa.');
    if(m.type==='botRetry'){
      if(g.kind!=='bot'||!g.bot_error||thinking.has(g.id))throw Error('El motor no necesita reintento.');
      db.prepare('UPDATE games SET bot_error=NULL WHERE id=?').run(g.id);scheduleBot(g.id);return;
    }
    if(expired(g))return;
    const c=engine(g),color=g.white===uid?'w':'b';
    if(m.type==='move'){
      if(c.turn()!==color)throw Error('Es el turno de tu rival.');
      if(!/^[a-h][1-8]$/.test(m.from||'')||!/^[a-h][1-8]$/.test(m.to||'')||(m.promotion!==undefined&&!['q','r','b','n'].includes(m.promotion)))throw Error('Movimiento inválido.');
      const time=clocks(g),t=now();
      let move;try{move=c.move({from:m.from,to:m.to,promotion:m.promotion||'q'});}catch{throw Error('Movimiento inválido.');}
      const white=time?time.white+(color==='w'?TIME_CONTROLS[g.mode].increment:0):null,black=time?time.black+(color==='b'?TIME_CONTROLS[g.mode].increment:0):null;
      try{db.prepare('UPDATE games SET pgn=?,offer=NULL,white_ms=?,black_ms=?,turn_since=?,version=version+1 WHERE id=? AND version=?').run(c.pgn(),white,black,time?t:null,g.id,g.version);}catch(error){c.undo();throw error;}
      if(c.isGameOver()){
        const latest=get(g.id),reason=c.isCheckmate()?'Jaque mate':c.isStalemate()?'Ahogado':c.isInsufficientMaterial()?'Material insuficiente':c.isThreefoldRepetition()?'Repetición triple':'Regla de cincuenta movimientos';
        finish(latest,c.isCheckmate()?(color==='w'?'1-0':'0-1'):'1/2-1/2',reason);
      }
    }else if(m.type==='resign'){
      const draw=insufficientToMate(c,color==='w'?'b':'w');finish(g,draw?'1/2-1/2':color==='w'?'0-1':'1-0',draw?'Tablas: rival sin material de mate':'Rendición');
    }else if(m.type==='draw'){
      if(g.kind==='bot'){finish(g,'1/2-1/2','Tablas de práctica');publish(g.id);return;}
      if(g.offer&&g.offer!==uid)finish(g,'1/2-1/2','Tablas acordadas');
      else if(g.offer===uid)throw Error('Ya ofreciste tablas.');
      else db.prepare('UPDATE games SET offer=?,version=version+1 WHERE id=?').run(uid,g.id);
    }else throw Error('Acción desconocida.');
    publish(g.id);
    scheduleBot(g.id);
  }
  function tick(){
    for(const g of db.prepare("SELECT * FROM games WHERE status='active' AND white_ms IS NOT NULL").all())expired(g);
    match();
    for(const g of db.prepare("SELECT id FROM games WHERE status='active' AND kind='bot' AND bot_error IS NULL").all())scheduleBot(g.id);
  }
  return {handle,get,open,state,clocks,publish,tick,queueState,cancelSearch,queue,clear:()=>{stopped=true;queue.clear();engines.clear();thinking.clear();}};
}
