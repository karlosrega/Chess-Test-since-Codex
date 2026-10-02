import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {openDatabase} from '../lib/database.js';
import {Stockfish,stockfishPath} from '../lib/stockfish.js';
import {analyzePGN,classifyLoss,precision} from '../lib/analyze-game.js';
import {createAnalyses} from '../lib/analyses.js';

test('métrica propia: límites de pérdida, etiquetas y partidas sin jugadas',async()=>{
  assert.equal(classifyLoss(49),'correcta');assert.equal(classifyLoss(50),'imprecisión');assert.equal(classifyLoss(100),'error');assert.equal(classifyLoss(200),'grave');assert.equal(classifyLoss(0,true),'grave');
  assert.equal(precision([0,0]),100);assert.equal(precision([]),null);assert.equal(precision([5000]),precision([1000]));
  const result=await analyzePGN('',{search:()=>{throw Error('No debe llamarse');}});assert.equal(result.moves.length,0);assert.equal(result.whitePrecision,null);
});
test('análisis con motor real: identifica el error grave del mate del loco',async t=>{
  const engine=new Stockfish();t.after(()=>engine.close());
  const c=new Chess();for(const move of ['f3','e5','g4','Qh4#'])c.move(move);
  const result=await analyzePGN(c.pgn(),engine);
  assert.equal(result.nodes,200000);assert.equal(result.moves.length,4);
  assert.equal(result.moves[2].label,'grave');assert.ok(result.whitePrecision<100);
  assert.equal(result.moves[3].san,'Qh4#');assert.ok(result.moves[0].bestMove);
});
test('cola de análisis usa trabajador separado, guarda resultado y no duplica trabajos',async t=>{
  const db=openDatabase(':memory:');db.exec("INSERT INTO users(id,name) VALUES('a','Ana'),('b','Beto');INSERT INTO games(id,white,black,status,pgn) VALUES('ABC123','a','b','finished','');");
  let resolve;const done=new Promise(r=>{resolve=r;});
  const service=createAnalyses(db,{path:stockfishPath(),onUpdate:(id,status)=>{if(status.status==='done')resolve(status);}});
  t.after(async()=>{await service.close();db.close();});
  service.enqueue('ABC123');service.enqueue('ABC123');
  const status=await done;assert.equal(status.result.moves.length,0);assert.equal(status.attempts,1);
  assert.equal(db.prepare('SELECT count(*) n FROM analyses').get().n,1);
  assert.equal(service.enqueue('ABC123',{retry:true}).status,'done');
});
test('cola recupera trabajos interrumpidos y registra falta de motor como fallo explícito',async t=>{
  const db=openDatabase(':memory:');db.exec("INSERT INTO users(id,name) VALUES('a','Ana');INSERT INTO games(id,white,status) VALUES('ABC123','a','finished');INSERT INTO analyses(game,status,progress) VALUES('ABC123','processing',40);");
  const service=createAnalyses(db);t.after(async()=>{await service.close();db.close();});
  assert.equal(service.view('ABC123').status,'pending');service.pump();assert.equal(service.view('ABC123').status,'failed');assert.match(service.view('ABC123').error,/instalado/);
  assert.throws(()=>service.enqueue('NOGAME'),/terminadas/);
});
