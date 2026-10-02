import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {WebSocket} from 'ws';
import {openDatabase,SCHEMA_VERSION} from '../lib/database.js';
import {createAccounts,passwordHash} from '../lib/accounts.js';
import {createApp} from '../server.js';

test('login pendiente no recrea sesiones después de cambiar la contraseña',async()=>{
  const db=openDatabase(':memory:');
  try{
    const old=await passwordHash('contraseña anterior segura'),next=await passwordHash('contraseña nueva segura');
    db.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('race','Race','race@example.com',old);
    let changed=false;
    const guarded={prepare(sql){const statement=db.prepare(sql);if(sql==='SELECT * FROM users WHERE email=?')return{get(...args){const snapshot=statement.get(...args);queueMicrotask(()=>{db.prepare('UPDATE users SET password=? WHERE id=?').run(next,'race');db.prepare('DELETE FROM sessions WHERE user=?').run('race');changed=true;});return snapshot;}};return statement;}};
    const accounts=createAccounts(guarded);
    const req=Readable.from([Buffer.from(JSON.stringify({email:'race@example.com',password:'contraseña anterior segura'}))]);
    Object.assign(req,{method:'POST',headers:{host:'localhost',origin:'http://localhost','content-type':'application/json'},socket:{remoteAddress:'127.0.0.1'}});
    let status;const res={setHeader(){},writeHead(value){status=value;},end(){}};
    await accounts.handle(req,res,'/api/auth/login');
    assert.equal(changed,true);assert.equal(status,401);assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
  }finally{db.close();}
});

test('reloj y bots usan índices aun con un historial de 200000 partidas',()=>{
  const db=openDatabase(':memory:');
  try{
    db.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200000) INSERT INTO games(id,status) SELECT printf('%06X',x),'finished' FROM n;");
    for(const [sql,index] of [["SELECT * FROM games WHERE status='active' AND white_ms IS NOT NULL",'games_active_clocks'],["SELECT id FROM games WHERE status='active' AND kind='bot' AND bot_error IS NULL",'games_active_bots']]){
      const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all().map(row=>row.detail).join(' ');
      assert.ok(plan.includes(index),plan);assert.doesNotMatch(plan,/SCAN games/);assert.equal(db.prepare(sql).all().length,0);
    }
  }finally{db.close();}
});

test('desconexión del rival anterior no reemplaza la partida actual; revancha sigue funcionando',async t=>{
  const app=createApp({database:':memory:',production:false,clock:()=>1000000});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  async function client(name){
    const ws=new WebSocket(`ws://127.0.0.1:${app.server.address().port}/ws`),messages=[];
    ws.on('message',raw=>messages.push(JSON.parse(raw)));await new Promise(r=>ws.once('open',r));
    const wait=async predicate=>{for(let i=0;i<300;i++){const index=messages.findIndex(predicate);if(index>=0)return messages.splice(index,1)[0];await new Promise(r=>setTimeout(r,10));}throw Error('Timeout WebSocket');};
    ws.send(JSON.stringify({type:'hello',name}));const hello=await wait(m=>m.type==='hello');
    return{ws,messages,uid:hello.user.id,wait,send:m=>ws.send(JSON.stringify(m))};
  }
  const a=await client('Actual A'),b=await client('Anterior B'),c=await client('Actual C');
  const old=app.games.handle(a.uid,{type:'create'});app.games.handle(b.uid,{type:'join',code:old});
  app.games.handle(b.uid,{type:'resign',id:old,version:app.games.get(old).version});
  await a.wait(m=>m.type==='game'&&m.game.id===old&&m.game.status==='finished');
  const current=app.games.handle(a.uid,{type:'create'});app.games.handle(c.uid,{type:'join',code:current});
  await a.wait(m=>m.type==='game'&&m.game.id===current&&m.game.status==='active');a.messages.length=0;
  const closed=new Promise(r=>b.ws.once('close',r));b.ws.close();await closed;
  a.send({type:'stats'});await a.wait(m=>m.type==='stats');
  assert.equal(a.messages.some(m=>m.type==='game'&&m.game.id===old),false);assert.equal(app.games.get(current).status,'active');
  app.games.handle(c.uid,{type:'resign',id:current,version:app.games.get(current).version});
  app.games.handle(a.uid,{type:'rematch',id:current,version:app.games.get(current).version});
  await c.wait(m=>m.type==='game'&&m.game.id===current&&m.game.rematchOffer===a.uid);
  const rematch=app.games.handle(c.uid,{type:'rematch',id:current,version:app.games.get(current).version});
  assert.equal((await a.wait(m=>m.type==='game'&&m.game.id===rematch)).game.status,'active');
});


test('v5 migration preserves games and snapshot before adding indexes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'chess-v5-')),path=join(dir,'game.sqlite');
  const previous=openDatabase(path);
  previous.exec("INSERT INTO games(id,status,pgn) VALUES('ABCDEF','finished','1. e4');DROP INDEX games_active_clocks;DROP INDEX games_active_bots;DELETE FROM migration_log WHERE version=6;PRAGMA user_version=5;");previous.close();
  const upgraded=openDatabase(path);
  try{
    assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
    assert.equal(upgraded.prepare('SELECT pgn FROM games').get().pgn,'1. e4');
    const snapshot=new DatabaseSync(join(dir,readdirSync(dir).find(name=>name.endsWith('.bak'))),{readOnly:true});
    try{assert.equal(snapshot.prepare('PRAGMA user_version').get().user_version,5);assert.equal(snapshot.prepare('SELECT pgn FROM games').get().pgn,'1. e4');}finally{snapshot.close();}
  }finally{upgraded.close();}
});
