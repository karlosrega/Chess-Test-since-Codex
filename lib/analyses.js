import {Worker} from 'node:worker_threads';

export function createAnalyses(db,{path,nodes=200000,onUpdate=()=>{},workerFactory=(url,options)=>new Worker(url,options)}={}){
  let worker=null,current=null,closed=false,enginePid=null;
  db.prepare("UPDATE analyses SET status='pending',progress=0,error=NULL WHERE status='processing'").run();
  const row=id=>db.prepare('SELECT * FROM analyses WHERE game=?').get(id);
  function view(id){const found=row(id);return found?{game:id,status:found.status,progress:found.progress,error:found.error,attempts:found.attempts,result:found.result?JSON.parse(found.result):null}:{game:id,status:'none',progress:0,result:null};}
  function announce(id){onUpdate(id,view(id));}
  function fail(error){
    if(closed)return;
    if(current){const id=current;current=null;db.prepare("UPDATE analyses SET status='failed',error=?,finished=CURRENT_TIMESTAMP WHERE game=?").run('El trabajador de análisis se detuvo. Puedes reintentarlo.',id);announce(id);}
    if(enginePid){try{process.kill(enginePid);}catch{}enginePid=null;}
    worker=null;
    // Other persisted jobs remain pending. A fresh worker is created on the next pump.
  }
  function ensureWorker(){
    if(worker)return;
    worker=workerFactory(new URL('./analysis-worker.js',import.meta.url),{workerData:{path,nodes}});
    const activeWorker=worker;
    worker.on('message',message=>{
      if(closed||activeWorker!==worker)return;
      if(message.type==='engineExit'){if(enginePid===message.pid)enginePid=null;return;}
      if(message.id!==current)return;
      if(message.type==='enginePid'){enginePid=message.pid;return;}
      const id=current;
      if(message.type==='progress'){db.prepare('UPDATE analyses SET progress=? WHERE game=?').run(message.progress,id);announce(id);return;}
      if(message.type==='done')db.prepare("UPDATE analyses SET status='done',progress=100,result=?,error=NULL,finished=CURRENT_TIMESTAMP WHERE game=?").run(JSON.stringify(message.result),id);
      else if(message.type==='failed')db.prepare("UPDATE analyses SET status='failed',error=?,finished=CURRENT_TIMESTAMP WHERE game=?").run(message.error,id);
      else return;
      current=null;announce(id);pump();
    });
    worker.on('error',error=>{if(activeWorker===worker)fail(error);});worker.on('exit',()=>{if(!closed&&activeWorker===worker)fail();});
  }
  function pump(){
    if(closed||current)return;
    const next=db.prepare("SELECT a.game,g.pgn FROM analyses a JOIN games g ON g.id=a.game WHERE a.status='pending' ORDER BY a.created,a.game LIMIT 1").get();
    if(!next)return;
    if(!path){db.prepare("UPDATE analyses SET status='failed',error=? WHERE game=?").run('Stockfish no está instalado en el servidor.',next.game);announce(next.game);return;}
    current=next.game;
    db.prepare("UPDATE analyses SET status='processing',progress=0,attempts=attempts+1,error=NULL WHERE game=?").run(current);
    try{ensureWorker();worker.postMessage({type:'analyze',id:current,pgn:next.pgn});announce(current);}catch(error){fail(error);}
  }
  function enqueue(id,{retry=false}={}){
    const g=db.prepare("SELECT id FROM games WHERE id=? AND status='finished'").get(id);if(!g)throw Error('Solo se pueden analizar partidas terminadas.');
    db.prepare('INSERT OR IGNORE INTO analyses(game) VALUES(?)').run(id);
    if(retry)db.prepare("UPDATE analyses SET status='pending',progress=0,error=NULL,result=NULL,finished=NULL WHERE game=? AND status='failed'").run(id);
    pump();return view(id);
  }
  const timer=setInterval(pump,1000);timer.unref();
  return {view,enqueue,pump,close:async()=>{
    closed=true;clearInterval(timer);
    if(current)db.prepare("UPDATE analyses SET status='pending',progress=0,error=NULL WHERE game=? AND status='processing'").run(current);
    if(worker){const active=worker;await new Promise(resolve=>{const timer=setTimeout(()=>{if(enginePid){try{process.kill(enginePid);}catch{}}active.terminate().finally(resolve);},5000);active.once('exit',()=>{clearTimeout(timer);resolve();});active.postMessage({type:'close'});});}
    current=null;worker=null;
  }};
}
