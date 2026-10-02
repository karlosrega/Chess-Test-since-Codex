import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';

const mode=process.argv[2],base='http://127.0.0.1:3000',origin='https://qa.invalid',path='/app/data/qa-state.json';
async function request(route,body,account){
  const response=await fetch(base+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(account?{Cookie:account.cookie,'X-CSRF-Token':account.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const json=await response.json();assert.ok(response.ok,JSON.stringify(json));return {response,json};
}
async function register(index){const {response,json}=await request('/api/auth/register',{name:'Contenedor '+index,email:'container'+index+'@example.com',password:'Solo CI sintético 2026!'});assert.match(response.headers.get('set-cookie'),/Secure/);return {...json,cookie:response.headers.get('set-cookie').split(';')[0]};}
async function connect(account){
  const ws=new WebSocket(base.replace('http','ws')+'/ws',{headers:{Cookie:account.cookie,Origin:origin}}),messages=[],waiters=[];let game;
  ws.on('error',()=>{});ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='game')game=message.game;const i=waiters.findIndex(w=>w.match(message));if(i>=0)waiters.splice(i,1)[0].resolve(message);else messages.push(message);});
  const next=match=>{const i=messages.findIndex(match);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Timeout WebSocket CI')),15000);waiters.push({match,resolve:m=>{clearTimeout(timeout);resolve(m);}});});};
  await next(m=>m.type==='hello');return {ws,next,get game(){return game;},send:m=>ws.send(JSON.stringify({id:game?.id,version:game?.version,...m}))};
}
if(mode==='seed'){
  const a=await register(1),b=await register(2);
  const run=(await request('/api/training/start',{item:'p01'},a)).json;
  await request('/api/training/run/'+run.id,{type:'move',version:run.version,move:'e1e8'},a);
  const white=await connect(a),black=await connect(b);
  white.send({type:'create',mode:'blitz',color:'white'});const waiting=await white.next(m=>m.type==='game');
  black.send({type:'join',code:waiting.game.id});await white.next(m=>m.type==='game'&&m.game.status==='active');await black.next(m=>m.type==='game');
  white.send({type:'move',from:'e2',to:'e4'});const moved=await white.next(m=>m.type==='game'&&m.game.moves.length===1);await black.next(m=>m.type==='game'&&m.game.moves.length===1);
  writeFileSync(path,JSON.stringify({a,b,id:moved.game.id,blackClock:moved.game.clocks.black}),{mode:0o600});white.ws.terminate();black.ws.terminate();
  console.log('seed: cuentas, entrenamiento y partida activa persistidos');
}else if(mode==='resume'){
  const {a,b,id,blackClock}=JSON.parse(readFileSync(path,'utf8')),white=await connect(a),black=await connect(b);
  const state=(await white.next(m=>m.type==='game')).game;await black.next(m=>m.type==='game');
  assert.equal(state.id,id);assert.deepEqual(state.moves,['e4']);assert.ok(state.clocks.black<blackClock,'el reloj incluye el tiempo detenido');assert.equal(state.status,'active');
  black.send({type:'resign'});await white.next(m=>m.type==='game'&&m.game.status==='finished');await black.next(m=>m.type==='game'&&m.game.status==='finished');
  let analysis;for(let i=0;i<150;i++){analysis=(await request('/api/analysis/'+id,null,a)).json;if(analysis.status==='done')break;assert.notEqual(analysis.status,'failed');await new Promise(r=>setTimeout(r,200));}assert.equal(analysis.status,'done');white.ws.terminate();black.ws.terminate();console.log('resume: reconexión, reloj, resultado y análisis completos');
}else if(mode==='mutate'){await register(3);console.log('mutate: cuenta posterior al backup creada');}
else if(mode==='restored'){
  const {a,id}=JSON.parse(readFileSync(path,'utf8'));assert.equal((await request('/api/auth/session',null,a)).json.user.id,a.user.id);assert.equal((await request('/api/analysis/'+id,null,a)).json.status,'done');
  const db=new DatabaseSync('/app/data/chess.sqlite',{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM users WHERE email IS NOT NULL').get().n,2);assert.equal(db.prepare("SELECT count(*) n FROM training_runs WHERE status='solved'").get().n,1);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);}finally{db.close();}console.log('restore: cuentas, progreso y análisis conservados; datos posteriores retirados');
}else throw Error('Escenario CI inválido');
