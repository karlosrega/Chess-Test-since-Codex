import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocket} from 'ws';
import {createApp} from '../server.js';

test('dos clientes WebSocket: cola pública, reloj, revisión y Elo sin duplicados',async t=>{
  const app=createApp({database:':memory:',production:false,clock:()=>1000000});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const url=`ws://127.0.0.1:${app.server.address().port}/ws`;
  async function client(name){
    const ws=new WebSocket(url),messages=[],waiting=[];let current;
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='game')current=m.game;const i=waiting.findIndex(w=>w.type===m.type);if(i>=0)waiting.splice(i,1)[0].resolve(m);else messages.push(m);});
    const next=type=>{const i=messages.findIndex(m=>m.type===type);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout '+type)),3000);waiting.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}});});};
    await new Promise(resolve=>ws.once('open',resolve));ws.send(JSON.stringify({type:'hello',name}));const hello=await next('hello');
    return {ws,next,id:hello.user.id,send:m=>ws.send(JSON.stringify({id:current?.id,version:current?.version,...m})),get game(){return current;}};
  }
  const a=await client('Rival Uno'),b=await client('Rival Dos');
  a.send({type:'queue',mode:'blitz'});assert.equal((await a.next('queue')).searching,true);
  b.send({type:'queue',mode:'blitz'});
  const ga=(await a.next('game')).game,gb=(await b.next('game')).game;
  assert.equal(ga.id,gb.id);assert.equal(ga.mode,'blitz');assert.equal(ga.rated,true);assert.equal(ga.clocks.white,180000);
  const w=ga.white.id===a.id?a:b,black=w===a?b:a;
  w.send({type:'move',from:'e2',to:'e4'});await w.next('game');await black.next('game');
  assert.ok(w.game.clocks.white>180000);assert.equal(w.game.version,ga.version+1);
  black.send({type:'resign'});const final=(await w.next('game')).game;await black.next('game');
  assert.equal(final.status,'finished');assert.equal(final.white.rating,1216);assert.equal(final.black.rating,1184);
  black.send({type:'resign',version:ga.version});assert.match((await black.next('error')).message,/cambió/);
  assert.equal(app.db.prepare('SELECT count(*) n FROM ratings').get().n,2);
});

test('última conexión cerrada cancela búsqueda y varias pestañas no se emparejan consigo mismas',async t=>{
  const app=createApp({database:':memory:',production:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`);
  const messages=[];ws.on('message',raw=>messages.push(JSON.parse(raw)));
  await new Promise(resolve=>ws.once('open',resolve));
  let next=new Promise(resolve=>ws.once('message',resolve));ws.send(JSON.stringify({type:'hello',name:'En Busca'}));await next;
  const uid=messages[0].user.id,token=messages[0].token;
  next=new Promise(resolve=>ws.once('message',resolve));ws.send(JSON.stringify({type:'queue',mode:'rapid'}));await next;
  assert.equal(app.games.queue.size,1);assert.equal(app.games.open(uid),undefined);
  const second=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`);
  await new Promise(resolve=>second.once('open',resolve));
  next=new Promise(resolve=>second.once('message',resolve));second.send(JSON.stringify({type:'hello',token}));await next;
  next=new Promise(resolve=>second.once('message',raw=>resolve(JSON.parse(raw))));second.send(JSON.stringify({type:'queue',mode:'rapid'}));
  assert.match((await next).message,/abierta/);
  const closed=new Promise(resolve=>ws.once('close',resolve));ws.close();await closed;
  assert.equal(app.games.queue.size,1);
  const canceled=new Promise(resolve=>{const original=app.games.cancelSearch;app.games.cancelSearch=(...args)=>{original(...args);resolve();};});
  second.close();await canceled;
  assert.equal(app.games.queue.size,0);
});
