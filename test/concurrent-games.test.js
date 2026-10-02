import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {WebSocket} from 'ws';
import {createApp} from '../server.js';

const count=Number(process.env.LOAD_CLIENTS||32);
if(!Number.isInteger(count)||count<2||count>200||count%2)throw Error('LOAD_CLIENTS requiere un número par entre2 y200.');
test(`${count} sesiones autenticadas: ${count/2} partidas simultáneas sin cruces de estado ni resultados duplicados`,async t=>{
  const app=createApp({database:':memory:',production:false,clock:()=>1000000,trustedProxy:'127.0.0.1'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`,clients=[],latencies=[],lag=monitorEventLoopDelay({resolution:20});lag.enable();t.after(()=>lag.disable());
  async function client(index){
    const uid='load-'+index,token=randomBytes(32).toString('hex');app.db.prepare('INSERT INTO users(id,name,email) VALUES(?,?,?)').run(uid,'Jugador '+index,'load-'+index+'@example.com');app.db.prepare('INSERT INTO sessions(token,user,csrf,expires) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),uid,'synthetic-csrf',Date.now()+60000);
    const ws=new WebSocket(origin.replace('http','ws')+'/ws',{headers:{Cookie:'chessSession='+token,Origin:origin,'X-Forwarded-For':'203.0.113.'+(index+1)}}),messages=[],waiters=[];let game;
    ws.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='game'){game=message.game;assert.ok([game.white?.id,game.black?.id].includes(uid),'privacidad de la partida');}const waiter=waiters.findIndex(w=>w.predicate(message));if(waiter>=0)waiters.splice(waiter,1)[0].resolve(message);else messages.push(message);});
    ws.on('error',()=>{});
    const next=predicate=>{const found=messages.findIndex(predicate);if(found>=0)return Promise.resolve(messages.splice(found,1)[0]);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timeout cliente '+index)),5000);waiters.push({predicate,resolve:message=>{clearTimeout(timer);resolve(message);}});});};
    await next(message=>message.type==='hello');
    return {uid,ws,next,messages,get game(){return game;},send:message=>ws.send(JSON.stringify({id:game?.id,version:game?.version,...message}))};
  }
  clients.push(...await Promise.all(Array.from({length:count},(_,index)=>client(index))));
  await Promise.all(clients.map(async c=>{c.send({type:'queue',mode:'rapid'});await c.next(message=>message.type==='game');}));
  const ids=[...new Set(clients.map(c=>c.game.id))];assert.equal(ids.length,count/2);assert.equal(app.games.queue.size,0);
  await Promise.all(ids.map(async id=>{
    const pair=clients.filter(c=>c.game.id===id),white=pair.find(c=>c.game.white.id===c.uid),black=pair.find(c=>c!==white);
    async function action(actor,message){const version=actor.game.version,start=performance.now();actor.send(message);await Promise.all(pair.map(c=>c.next(m=>m.type==='game'&&m.game.id===id&&m.game.version>version)));latencies.push(performance.now()-start);}
    for(const [actor,from,to] of [[white,'e2','e4'],[black,'e7','e5'],[white,'g1','f3'],[black,'b8','c6']])await action(actor,{type:'move',from,to});
    await action(white,{type:'draw'});await action(black,{type:'draw'});assert.equal(white.game.result,'1/2-1/2');assert.equal(white.game.status,'finished');
  }));
  assert.equal(app.db.prepare("SELECT count(*) n FROM games WHERE status='finished'").get().n,count/2);assert.equal(app.db.prepare('SELECT count(*) n FROM ratings').get().n,count);
  assert.equal(app.db.prepare('SELECT count(*) n FROM users WHERE played=1').get().n,count);assert.equal(clients.flatMap(c=>c.messages||[]).filter(m=>m.type==='error').length,0);
  latencies.sort((a,b)=>a-b);const p95=latencies[Math.floor(latencies.length*.95)];assert.ok(p95<1000,`Respuesta p95 ${p95.toFixed(0)}ms`);
  t.diagnostic(`${count} conexiones,${count/2} partidas,${count*3} acciones; p95=${p95.toFixed(1)}ms; event loop p99=${(lag.percentile(99)/1e6).toFixed(1)}ms; RSS=${(process.memoryUsage().rss/1048576).toFixed(1)}MiB. Sesiones sintéticas; no mide carga de login ni certifica capacidad del servidor destino.`);
});
