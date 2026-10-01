import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createApp} from '../server.js';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('SQLite conserva usuarios y una sala después de reiniciar',async()=>{
  const database=join(mkdtempSync(join(tmpdir(),'chess-test-')),'test.sqlite');
  const first=createApp({database});
  first.db.prepare('INSERT INTO users(id,token,name) VALUES(?,?,?)').run('test-user','test-hash','Persistente');
  first.db.prepare('INSERT INTO games(id,white) VALUES(?,?)').run('ABC123','test-user');
  await first.close();
  const second=createApp({database});
  try {assert.equal(second.db.prepare('SELECT name FROM users').get().name,'Persistente');assert.equal(second.db.prepare('SELECT status FROM games').get().status,'waiting');}
  finally {await second.close();}
});

test('dos jugadores: identidad, turnos, mate, Elo e historial persistido',async t=>{
  const app=createApp({database:':memory:'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>app.close());
  const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
  async function client(){const ws=new WebSocket(url),queue=[],wait=[];ws.on('message',raw=>{const m=JSON.parse(raw);const i=wait.findIndex(w=>w.type===m.type);if(i>=0)wait.splice(i,1)[0].resolve(m);else queue.push(m);});await new Promise(r=>ws.on('open',r));return{ws,send:m=>ws.send(JSON.stringify(m)),next:type=>{const i=queue.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout: '+type)),3000);wait.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});}};}
  const w=await client(),b=await client();
  w.send({type:'hello',name:'Ana'});const wu=await w.next('hello');
  b.send({type:'hello',name:'Luis'});await b.next('hello');
  w.send({type:'create'});const waiting=(await w.next('game')).game;
  b.send({type:'join',code:waiting.id});assert.equal((await b.next('game')).game.status,'active');await w.next('game');
  b.send({type:'move',from:'e7',to:'e5'});assert.match((await b.next('error')).message,/turno/);
  w.send({type:'move',from:'e2',to:'e5'});await w.next('error');
  for(const [c,from,to] of [[w,'f2','f3'],[b,'e7','e5'],[w,'g2','g4'],[b,'d8','h4']]){c.send({type:'move',from,to});await w.next('game');await b.next('game');}
  w.send({type:'stats'});const stats=await w.next('stats');assert.equal(stats.user.rating,1184);assert.equal(stats.user.played,1);assert.equal(stats.history[0].result,'0-1');assert.equal(app.db.prepare('SELECT count(*) n FROM ratings').get().n,2);
  b.send({type:'resign'});await b.next('error');assert.equal(app.db.prepare('SELECT played FROM users WHERE name=?').get('Luis').played,1);
  const again=await client();again.send({type:'hello',token:wu.token});assert.equal((await again.next('hello')).user.name,'Ana');
});

test('reglas: enroque, captura al paso, promoción y repetición',async()=>{
  const {Chess}=await import('chess.js');
  const castle=new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');assert.equal(castle.move('O-O').to,'g1');
  const ep=new Chess();for(const m of ['e4','a6','e5','d5'])ep.move(m);assert.equal(ep.move('exd6').flags,'e');
  const promotion=new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');assert.equal(promotion.move({from:'a7',to:'a8',promotion:'n'}).promotion,'n');
  const repeated=new Chess();for(const m of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8'])repeated.move(m);assert.equal(repeated.isThreefoldRepetition(),true);
});
