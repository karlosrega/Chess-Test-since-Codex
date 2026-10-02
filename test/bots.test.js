import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/database.js';
import {createGames} from '../lib/games.js';
import {Stockfish} from '../lib/stockfish.js';
import {statisticsFor} from '../lib/statistics.js';

function setup(t,botMove){const db=openDatabase(':memory:');db.prepare("INSERT INTO users(id,name) VALUES('human','Humano')").run();const games=createGames(db,{botMove});t.after(()=>{games.clear();db.close();});return{db,games};}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('bot real: tres dificultades, color y respuesta legal sin reloj ni Elo',async t=>{
  const engine=new Stockfish();t.after(()=>engine.close());
  for(const level of ['easy','medium','hard']){
    const {db,games}=setup(t,(fen,options)=>engine.search(fen,options));
    const id=games.handle('human',{type:'bot',level,color:'black'});
    assert.equal(games.state(games.get(id)).botThinking,true);
    await engine.chain; // scheduleBot enters the promise on the next microtask.
    while(games.state(games.get(id)).botThinking)await turn();
    const g=games.get(id),state=games.state(g);assert.equal(state.moves.length,1);assert.equal(state.turn,'b');assert.equal(state.clocks,null);assert.equal(g.black,'human');
    games.handle('human',{type:'resign',id,version:g.version});
    assert.equal(db.prepare('SELECT count(*) n FROM ratings').get().n,0);
    assert.equal(statisticsFor(db,'human').played,0);
  }
});
test('fallo de bot se guarda, permite reintento y evita respuestas después de rendición',async t=>{
  let reject,resolve;
  const {games,db}=setup(t,()=>new Promise((res,rej)=>{resolve=res;reject=rej;}));
  const id=games.handle('human',{type:'bot',level:'easy',color:'black'});
  await turn();reject(Error('Fallo simulado'));await turn();
  assert.ok(games.get(id).bot_error);assert.equal(games.state(games.get(id)).botThinking,false);
  games.handle('human',{type:'botRetry',id,version:games.get(id).version});await turn();
  assert.equal(games.get(id).bot_error,null);
  games.handle('human',{type:'resign',id,version:games.get(id).version});
  resolve('e2e4');await turn();assert.equal(games.get(id).pgn,'');assert.equal(games.get(id).status,'finished');
  assert.equal(db.prepare('SELECT played FROM users WHERE id=?').get('human').played,0);
});
test('bot reanuda su turno después de reiniciar y revancha intercambia piezas',async t=>{
  const {games,db}=setup(t,async()=>{throw Error('interrumpido');});
  const id=games.handle('human',{type:'bot',color:'white'});
  games.handle('human',{type:'move',id,version:games.get(id).version,from:'e2',to:'e4'});await turn();
  db.prepare('UPDATE games SET bot_error=NULL WHERE id=?').run(id);
  const reboot=createGames(db,{botMove:async()=>({move:'e7e5'})});t.after(()=>reboot.clear());reboot.tick();await turn();
  assert.equal(reboot.state(reboot.get(id)).moves.length,2);
  reboot.handle('human',{type:'resign',id,version:reboot.get(id).version});
  const next=reboot.handle('human',{type:'rematch',id,version:reboot.get(id).version});await turn();
  assert.equal(reboot.get(next).black,'human');assert.equal(reboot.get(next).kind,'bot');
});
