import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {Chess} from 'chess.js';

export const catalog=JSON.parse(readFileSync(new URL('./training-catalog.json',import.meta.url),'utf8'));
const items=new Map(catalog.map(item=>[item.id,item]));
const same=(path,line)=>path.every((move,i)=>move===line[i]);
function play(chess,move){return chess.move({from:move.slice(0,2),to:move.slice(2,4),...(move[4]?{promotion:move[4]}:{})});}
function position(item,path){const chess=new Chess(item.fen);for(const move of path)play(chess,move);return chess;}
function publicItem({solutions,verification,explanation,...item}){return item;}

export function trainingProgress(db,user){
  const result={puzzles:{solved:0,unassisted:0,total:30},exercises:{solved:0,unassisted:0,total:12},attempts:0,hints:0};
  if(!user)return result;
  const rows=db.prepare("SELECT item,count(*) attempts,sum(hints) hints,max(status='solved') solved,max(status='solved' AND assisted=0) unassisted FROM training_runs WHERE user=? GROUP BY item").all(user);
  for(const row of rows){const item=items.get(row.item);if(!item)continue;const category=result[item.kind==='puzzle'?'puzzles':'exercises'];category.solved+=row.solved;category.unassisted+=row.unassisted;result.attempts+=row.attempts;result.hints+=row.hints;}
  return result;
}

export function createTraining(db){
  function list(user,kind){
    if(!['puzzle','exercise'].includes(kind))throw Error('Tipo de entrenamiento inválido.');
    const progress=user?db.prepare("SELECT item,count(*) attempts,max(status='solved') solved,max(status='solved' AND assisted=0) unassisted,max(CASE WHEN status='active' THEN id END) active FROM training_runs WHERE user=? GROUP BY item").all(user):[];
    return {items:catalog.filter(x=>x.kind===kind).map(item=>({...publicItem(item),progress:progress.find(x=>x.item===item.id)||{attempts:0,solved:0,unassisted:0,active:null}})),progress:trainingProgress(db,user)};
  }
  function get(user,id){const run=db.prepare('SELECT * FROM training_runs WHERE id=? AND user=?').get(id,user);if(!run)throw Error('Intento no encontrado.');return run;}
  function view(run){
    const item=items.get(run.item),path=JSON.parse(run.path),chess=position(item,path);
    return {id:run.id,item:publicItem(item),version:run.version,status:run.status,mode:run.mode,assisted:Boolean(run.assisted),hints:run.hints,errors:run.errors,fen:chess.fen(),board:chess.board(),turn:chess.turn(),check:chess.isCheck(),legal:run.status==='active'?chess.moves({verbose:true}).map(({from,to,promotion})=>({from,to,promotion})):[],moves:chess.history(),lastMove:path.length?[path.at(-1).slice(0,2),path.at(-1).slice(2,4)]:[],canUndo:path.length>0&&run.status==='active'&&item.kind==='exercise',explanation:run.status==='solved'||run.status==='revealed'?item.explanation:null};
  }
  function start(user,id,{restart=false}={}){
    const item=items.get(id);if(!item)throw Error('Ejercicio no encontrado.');
    const active=db.prepare("SELECT * FROM training_runs WHERE user=? AND item=? AND status='active'").get(user,id);
    if(active&&!restart)return view(active);
    db.exec('BEGIN IMMEDIATE');
    try{if(active)db.prepare("UPDATE training_runs SET status='abandoned',updated=CURRENT_TIMESTAMP WHERE id=?").run(active.id);const runId=randomBytes(12).toString('hex');db.prepare('INSERT INTO training_runs(id,user,item) VALUES(?,?,?)').run(runId,user,id);db.exec('COMMIT');return view(get(user,runId));}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function action(user,id,message){
    const run=get(user,id),item=items.get(run.item),path=JSON.parse(run.path);
    if(message.version!==run.version)throw Error('El tablero cambió en otra pestaña. Recarga el ejercicio.');
    if(run.status!=='active')throw Error('Este intento terminó. Inicia otro para practicar.');
    let feedback='',hint=null;
    const lines=item.solutions.filter(line=>same(path,line));
    if(message.type==='hint'){
      if(run.mode!=='guided')throw Error('Vuelve a la guía para pedir una pista.');
      run.assisted=1;run.hints++;const next=lines[0]?.[path.length];
      hint=run.hints===1?`Observa la pieza en ${next?.slice(0,2)}.`:`Prueba ${next?.slice(0,2)} → ${next?.slice(2,4)}${next?.[4]?' y corona en '+next[4]:''}.`;
    }else if(message.type==='reveal'){
      run.assisted=1;run.status='revealed';path.splice(0,path.length,...item.solutions[0]);feedback='Solución mostrada. No cuenta como un ejercicio resuelto.';
    }else if(['explore','guide','undo'].includes(message.type)){
      if(item.kind!=='exercise')throw Error('Esta acción solo está disponible en práctica guiada.');
      run.assisted=1;
      if(message.type==='explore'){run.mode='explore';feedback='Exploración libre: puedes mover ambos lados. No suma ejercicios resueltos.';}
      if(message.type==='guide'){run.mode='guided';path.length=0;feedback='Guía reiniciada. Este intento queda marcado con ayuda.';}
      if(message.type==='undo'){if(!path.length)throw Error('No hay jugadas para deshacer.');path.splice(Math.max(0,path.length-(run.mode==='guided'?2:1)));}
    }else if(message.type==='move'){
      if(typeof message.move!=='string'||! /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(message.move))throw Error('Jugada inválida.');
      const chess=position(item,path);try{play(chess,message.move);}catch{throw Error('La jugada no es legal en esta posición.');}
      if(run.mode==='explore'){path.push(message.move);feedback=chess.isCheckmate()?'Jaque mate en tu exploración.':chess.isDraw()?'Tablas en tu exploración.':'Puedes continuar explorando o volver a la guía.';}
      else{
        const accepted=lines.filter(line=>line[path.length]===message.move);
        if(!accepted.length){run.errors++;feedback='Es legal, pero no resuelve este reto. Inténtalo de nuevo.';}
        else{path.push(message.move);const line=accepted[0];if(path.length<line.length)path.push(line[path.length]);if(path.length===line.length){run.status='solved';feedback=run.assisted?'¡Resuelto con ayuda!':'¡Resuelto por tu cuenta!';}else feedback='Bien. El rival respondió: encuentra tu siguiente jugada.';}
      }
    }else throw Error('Acción de entrenamiento desconocida.');
    const updated=db.prepare('UPDATE training_runs SET path=?,version=version+1,assisted=?,hints=?,errors=?,mode=?,status=?,updated=CURRENT_TIMESTAMP WHERE id=? AND user=? AND version=?').run(JSON.stringify(path),run.assisted,run.hints,run.errors,run.mode,run.status,id,user,run.version);
    if(updated.changes!==1)throw Error('El ejercicio cambió. Recarga para continuar.');
    return {...view(get(user,id)),feedback,hint};
  }
  return {list,start,action,get:(user,id)=>view(get(user,id))};
}
