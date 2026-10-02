import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {Stockfish} from '../lib/stockfish.js';

test('Stockfish19 real: identifica versión, produce jugadas legales y serializa búsquedas',async t=>{
  const engine=new Stockfish();t.after(()=>engine.close());
  const chess=new Chess();
  const results=await Promise.all([engine.search(chess.fen(),{nodes:3000,skill:0}),engine.search(chess.fen(),{nodes:20000,skill:8}),engine.search(chess.fen(),{nodes:100000,skill:16})]);
  for(const result of results){assert.match(result.engine,/Stockfish 19/);assert.ok(result.evaluation);assert.ok(chess.moves({verbose:true}).some(m=>m.from+m.to+(m.promotion||'')===result.move));}
  assert.equal(engine.pending,0);
  await assert.rejects(engine.search(chess.fen()+'\ngo infinite'),/inválidos/);
  await assert.rejects(engine.search(chess.fen(),{skill:30}),/inválidos/);
  await assert.rejects(engine.search('6k1/7R/5N2/8/8/8/8/6K1 w - - 0 1'),/inválidos/);
});
test('Stockfish real encuentra mate y soporta restricciones de jugada para análisis',async t=>{
  const engine=new Stockfish();t.after(()=>engine.close());
  const chess=new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
  const mate=await engine.search(chess.fen(),{nodes:20000});
  assert.equal(mate.evaluation.type,'mate');
  const restricted=await engine.search(chess.fen(),{nodes:20000,searchMoves:['g6g7']});
  assert.equal(restricted.move,'g6g7');assert.equal(restricted.evaluation.type,'mate');
});
