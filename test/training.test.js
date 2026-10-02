import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Chess} from 'chess.js';
import {openDatabase} from '../lib/database.js';
import {catalog,createTraining,trainingProgress} from '../lib/training.js';
import {createApp} from '../server.js';

function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());db.prepare("INSERT INTO users(id,name) VALUES('one','Uno'),('two','Dos')").run();return {db,training:createTraining(db)};}
function move(chess,uci){return chess.move({from:uci.slice(0,2),to:uci.slice(2,4),...(uci[4]?{promotion:uci[4]}:{})});}
function solve(training,user,item,run=training.start(user,item.id)){
  const line=item.solutions[0];for(let i=0;i<line.length;i+=2)run=training.action(user,run.id,{type:'move',version:run.version,move:line[i]});return run;
}

test('catálogo original: 30 tácticas, 12 ejercicios, todas las posiciones y soluciones legales',()=>{
  assert.equal(catalog.filter(x=>x.kind==='puzzle').length,30);assert.equal(catalog.filter(x=>x.kind==='exercise').length,12);
  for(const level of ['easy','medium','hard'])assert.equal(catalog.filter(x=>x.kind==='puzzle'&&x.difficulty===level).length,10);
  assert.equal(catalog.filter(x=>x.kind==='exercise'&&x.motif==='mate').length,6);assert.equal(catalog.filter(x=>x.kind==='exercise'&&x.motif==='final').length,6);
  assert.equal(new Set(catalog.filter(x=>x.kind==='puzzle').map(x=>x.fen)).size,30);
  for(const item of catalog){
    const initial=new Chess(item.fen),opposite=new Chess(item.fen.replace(` ${initial.turn()} `,` ${initial.turn()==='w'?'b':'w'} `));assert.equal(opposite.isCheck(),false,item.id+' posición previa ilegal');
    for(const line of item.solutions){const chess=new Chess(item.fen),captures=[];assert.equal(line.length%2,1,item.id);for(const uci of line){const played=move(chess,uci);if(played.color===item.color&&played.captured)captures.push(played.captured);}
      if(item.motif==='mate')assert.equal(chess.isCheckmate(),true,item.id);
      if(item.motif==='horquilla')assert.ok(captures.includes(item.title.startsWith('Dos')?'q':'n'),item.id);
      if(item.motif==='descubierto')assert.ok(captures.includes('q'),item.id);
      if(item.motif==='clavada')assert.ok(captures.includes('n'),item.id);
      if(item.motif==='final')assert.ok(chess.board().flat().some(p=>p?.type==='q'&&p.color===item.color),item.id);
    }
  }
});

test('entrenamiento: completar todo guarda progreso separado sin alterar Elo',t=>{
  const {db,training}=fixture(t);
  for(const item of catalog)assert.equal(solve(training,'one',item).status,'solved',item.id);
  const progress=trainingProgress(db,'one');assert.equal(progress.puzzles.solved,30);assert.equal(progress.exercises.solved,12);assert.equal(progress.puzzles.unassisted,30);assert.equal(progress.exercises.unassisted,12);
  assert.equal(db.prepare("SELECT rating,played FROM users WHERE id='one'").get().played,0);assert.equal(db.prepare('SELECT count(*) n FROM ratings').get().n,0);
  assert.equal(trainingProgress(db,'two').puzzles.solved,0);
  const ladder=catalog.find(x=>x.id==='p25');assert.ok(ladder.solutions.some(line=>line[0]==='a2a7'));assert.ok(ladder.solutions.some(line=>line[0]==='b1b7'));
  for(const line of ladder.solutions){let run=training.start('two',ladder.id,{restart:true});for(let i=0;i<line.length;i+=2)run=training.action('two',run.id,{type:'move',version:run.version,move:line[i]});assert.equal(run.status,'solved');}
  const visible=training.list('one','puzzle').items[0];assert.equal(visible.solutions,undefined);assert.equal(visible.explanation,undefined);assert.equal(visible.verification,undefined);
});

test('intentos: pista, respuesta incorrecta, versiones viejas, privacidad y reanudación',t=>{
  const {training}=fixture(t),item=catalog.find(x=>x.id==='p01');let run=training.start('one',item.id);
  assert.equal(training.start('one',item.id).id,run.id);assert.throws(()=>training.get('two',run.id),/no encontrado/);
  const wrong=run.legal.find(m=>!item.solutions.some(line=>line[0]===m.from+m.to+(m.promotion||'')));
  run=training.action('one',run.id,{type:'move',version:run.version,move:wrong.from+wrong.to});assert.equal(run.errors,1);assert.equal(run.fen,item.fen);
  assert.throws(()=>training.action('one',run.id,{type:'hint',version:0}),/otra pestaña/);
  run=training.action('one',run.id,{type:'hint',version:run.version});assert.equal(run.assisted,true);assert.match(run.hint,/Observa/);
  run=solve(training,'one',item,run);assert.equal(run.status,'solved');assert.equal(training.list('one','puzzle').items[0].progress.unassisted,0);
  assert.throws(()=>training.action('one',run.id,{type:'undo',version:run.version}),/terminó/);
  const retry=training.start('one',item.id);assert.notEqual(retry.id,run.id);solve(training,'one',item,retry);assert.equal(training.list('one','puzzle').items[0].progress.unassisted,1);
});

test('práctica: explorar ambos lados, deshacer, guía y solución sin crédito',t=>{
  const {db,training}=fixture(t),item=catalog.find(x=>x.id==='e04');let run=training.start('one',item.id);
  run=training.action('one',run.id,{type:'move',version:run.version,move:item.solutions[0][0]});assert.equal(run.moves.length,2);
  run=training.action('one',run.id,{type:'undo',version:run.version});assert.equal(run.fen,item.fen);assert.equal(run.assisted,true);
  run=training.action('one',run.id,{type:'explore',version:run.version});const first=run.legal[0];run=training.action('one',run.id,{type:'move',version:run.version,move:first.from+first.to+(first.promotion||'')});assert.equal(run.moves.length,1);
  run=training.action('one',run.id,{type:'undo',version:run.version});assert.equal(run.moves.length,0);
  run=training.action('one',run.id,{type:'guide',version:run.version});assert.equal(run.mode,'guided');
  run=training.action('one',run.id,{type:'reveal',version:run.version});assert.equal(run.status,'revealed');assert.equal(trainingProgress(db,'one').exercises.solved,0);
  assert.equal(training.list('one','exercise').items.find(x=>x.id===item.id).progress.solved,0);
});

test('API entrenamiento: autorización, CSRF, alternativas de mate y bloqueo en partida humana',async t=>{
  const app=createApp({database:':memory:',production:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());const origin=`http://127.0.0.1:${app.server.address().port}`;
  const register=await fetch(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Entrenador',email:'training@example.com',password:'Entrena sin secretos 2026'})});const cookie=register.headers.get('set-cookie').split(';')[0],account=await register.json();
  async function request(path,body,csrf=account.csrf){const response=await fetch(origin+'/api/training/'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
  assert.equal((await fetch(origin+'/api/training/start',{method:'POST'})).status,401);
  assert.equal((await request('start',{item:'p01'},'wrong')).status,403);
  const started=await request('start',{item:'p07'});assert.equal(started.status,200);const item=catalog.find(x=>x.id==='p07');const alternative=item.solutions.at(-1)[0];const solved=await request('run/'+started.body.id,{type:'move',version:started.body.version,move:alternative});assert.equal(solved.body.status,'solved');
  app.db.prepare("INSERT INTO users(id,name) VALUES('other','Rival')").run();app.db.prepare("INSERT INTO games(id,white,black,status,kind) VALUES('LIVE12',?,'other','active','friend')").run(account.user.id);
  assert.equal((await request('catalog?kind=puzzle')).status,409);assert.equal((await request('start',{item:'p01'})).status,409);
});
