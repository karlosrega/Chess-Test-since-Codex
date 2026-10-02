import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {openDatabase} from '../lib/database.js';
import {createGames,insufficientToMate} from '../lib/games.js';

function fixture(t){
  const db=openDatabase(':memory:');t.after(()=>db.close());
  for(const id of ['a','b','c'])db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run(id,id);
  let time=1000000;const events=[];
  const games=createGames(db,{now:()=>time,notify:(ids,message)=>events.push({ids,message})});
  const action=(uid,type,extra={})=>{const id=extra.id||games.open(uid)?.id;const g=id&&games.get(id);return games.handle(uid,{type,id,version:g?.version,...extra});};
  return {db,games,events,action,advance:ms=>{time+=ms;},friend:(mode='rapid',color='white')=>{const id=action('a','create',{mode,color});action('b','join',{code:id});return id;}};
}
test('salas: color elegido, reloj empieza al unirse y versión evita duplicados',t=>{
  const {games,action,advance}=fixture(t);
  const id=action('a','create',{mode:'blitz',color:'black'});
  assert.equal(games.get(id).black,'a');assert.equal(games.clocks(games.get(id)),null);
  advance(100000);action('b','join',{code:id});
  assert.equal(games.get(id).white,'b');assert.equal(games.clocks(games.get(id)).white,180000);
  const version=games.get(id).version;
  advance(1000);action('b','move',{from:'e2',to:'e4'});
  assert.equal(games.clocks(games.get(id)).white,181000);
  assert.throws(()=>action('b','move',{from:'e2',to:'e4',version}),/cambió/);
  assert.throws(()=>action('c','resign',{id}),/No perteneces/);
});
test('amistosas no cambian Elo; rendición se registra una sola vez',t=>{
  const {db,games,friend,action}=fixture(t),id=friend();
  action('a','resign');assert.equal(games.get(id).result,'0-1');
  assert.equal(db.prepare('SELECT count(*) n FROM ratings').get().n,0);
  assert.equal(db.prepare('SELECT rating FROM users WHERE id=?').get('a').rating,1200);
  assert.equal(db.prepare('SELECT played FROM users WHERE id=?').get('a').played,1);
  assert.throws(()=>action('a','resign',{id}),/activa/);
});
test('emparejamiento: mismo ritmo, Elo separado y exclusión de sala/búsqueda',t=>{
  const {db,games,action}=fixture(t);
  action('a','queue',{mode:'bullet'});assert.throws(()=>action('a','create'),/abierta/);
  action('b','queue',{mode:'blitz'});assert.equal(games.queue.size,2);
  action('b','queueCancel');action('b','queue',{mode:'bullet'});
  const g=games.get(games.open('a').id);assert.equal(g.kind,'match');assert.equal(g.rated,1);assert.equal(games.queue.size,0);
  action(g.white,'resign');
  assert.equal(db.prepare("SELECT rating FROM mode_ratings WHERE user=? AND mode='bullet'").get(g.white).rating,1184);
  assert.equal(db.prepare('SELECT rating FROM users WHERE id=?').get(g.white).rating,1200);
  assert.equal(db.prepare('SELECT count(*) n FROM ratings').get().n,2);
  assert.equal(db.prepare("SELECT played FROM mode_ratings WHERE user=? AND mode='blitz'").get('b').played,0);
});
test('emparejamiento amplía rango tras 15 segundos y permite cancelar',t=>{
  const {db,games,action,advance}=fixture(t);
  db.prepare("INSERT INTO mode_ratings(user,mode,rating) VALUES('b','rapid',1500)").run();
  action('a','queue',{mode:'rapid'});action('b','queue',{mode:'rapid'});assert.equal(games.queue.size,2);
  advance(14999);games.tick();assert.equal(games.queue.size,2);
  advance(1);games.tick();assert.equal(games.queue.size,0);assert.ok(games.open('a'));
  action('c','queue',{mode:'blitz'});action('c','queueCancel');assert.equal(games.queueState('c').searching,false);
});
test('tiempo agotado rechaza movimiento tardío y acaba una sola vez',t=>{
  const {db,games,friend,action,advance}=fixture(t),id=friend('bullet');
  advance(60000);action('a','move',{from:'e2',to:'e4'});
  assert.equal(games.get(id).pgn,'');assert.equal(games.get(id).result,'0-1');assert.equal(games.clocks(games.get(id)).white,0);
  games.tick();assert.equal(db.prepare('SELECT played FROM users WHERE id=?').get('a').played,1);
});
test('reiniciar servicio mantiene el tiempo transcurrido',t=>{
  const {db,games,friend,advance}=fixture(t),id=friend('rapid');
  advance(10000);
  const reboot=createGames(db,{now:()=>1010000});
  assert.equal(reboot.clocks(reboot.get(id)).white,590000);
  assert.equal(reboot.state(reboot.get(id)).turn,'w');
});
test('revancha necesita aceptación, intercambia colores y es amistosa',t=>{
  const {games,friend,action}=fixture(t),id=friend('blitz');action('a','resign');
  action('a','rematch',{id});const next=action('b','rematch',{id});
  assert.equal(games.get(next).white,'b');assert.equal(games.get(next).black,'a');
  assert.equal(games.get(next).status,'active');assert.equal(games.get(next).rated,0);
  assert.throws(()=>action('a','rematch',{id}),/existe/);
});
test('material de mate considera rey solo, caballo, alfiles y piezas del rival',()=>{
  assert.equal(insufficientToMate(new Chess('8/8/8/8/8/6k1/8/K6R w - - 0 1'),'b'),true);
  assert.equal(insufficientToMate(new Chess('8/8/8/8/8/6k1/8/KN6 w - - 0 1'),'w'),true);
  assert.equal(insufficientToMate(new Chess('8/8/8/8/8/6k1/7p/KN6 w - - 0 1'),'w'),false);
  assert.equal(insufficientToMate(new Chess('8/8/8/8/8/6k1/8/KNN5 w - - 0 1'),'w'),false);
  assert.equal(insufficientToMate(new Chess('8/8/8/8/8/6k1/8/KB6 w - - 0 1'),'w'),true);
});
