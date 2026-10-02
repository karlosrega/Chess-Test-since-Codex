import {writeFileSync} from 'node:fs';
import {Chess} from 'chess.js';
import {Stockfish} from '../lib/stockfish.js';

// Original teaching compositions. No imported puzzle database or third-party artwork.
const bases={
  back:['6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1','Mate de pasillo','mate','Da mate en una jugada.','La fila del fondo queda cerrada por los propios peones.'],
  queen:['7k/8/5KQ1/8/8/8/8/8 w - - 0 1','Dama y rey coordinados','mate','Da mate en una jugada.','Acerca la dama, protegida por tu rey, sin dejar casillas de escape.'],
  knight:['2q1k3/5ppp/8/5N2/8/8/5PPP/3Q2K1 w - - 0 1','Dos amenazas, un caballo','horquilla','Da jaque con el caballo y captura la dama.','Un jaque obliga al rey a responder: después recoge la dama atacada.'],
  pawn:['6k1/5ppp/2n1n3/8/3P4/8/5PPP/3Q2K1 w - - 0 1','Un peón contra dos caballos','horquilla','Avanza el peón central y gana un caballo.','El peón ataca dos casillas diagonales a la vez; no pueden escapar ambos caballos.'],
  discovery:['4k3/8/8/8/7q/4N3/5PPP/4R1K1 w - - 0 1','Abre la columna','descubierto','Da jaque descubierto y captura la dama.','Al apartar el caballo se abre la columna de la torre y nace una segunda amenaza.'],
  pin:['8/4k3/5n2/4P1B1/8/8/5PPP/6K1 w - - 0 1','La pieza inmovilizada','clavada','Captura el caballo clavado sin perder material.','El caballo no puede salir de la diagonal del alfil: dejaría a su rey en jaque.'],
  rook:['7k/8/5K2/8/8/8/8/R7 w - - 0 1','Cierra la última salida','mate','Fuerza el mate en dos jugadas propias.','Primero el rey restringe la huida; la torre da el jaque decisivo.'],
  ladder:['7k/8/8/8/8/8/R7/1R4K1 w - - 0 1','La escalera de torres','mate','Fuerza el mate en dos jugadas propias.','Una torre corta la fila de escape y la otra da mate desde la siguiente.'],
  rook3:['7k/8/8/4K3/8/8/8/R7 w - - 0 1','Rey activo, torre precisa','mate','Fuerza el mate en tres jugadas propias.','Mejora tu rey antes de usar la torre: las casillas de escape son la clave.'],
  opposition:['4k3/8/4K3/4P3/8/8/8/8 w - - 0 1','Rey delante del peón','final','Acompaña al peón hasta coronar.','El rey conquista las casillas de paso; evita empujar el peón sin apoyo.'],
  promotion:['7k/P7/8/8/8/8/8/6K1 w - - 0 1','El último paso','final','Corona el peón en dama.','Al alcanzar la última fila puedes elegir una pieza nueva. Aquí la dama conserva la ventaja.'],
};
function transform(fen,variant){
  const source=new Chess(fen),target=new Chess();target.clear();
  for(const row of source.board())for(const piece of row)if(piece){let file=piece.square.charCodeAt(0)-97,rank=Number(piece.square[1]);if(variant&1)file=7-file;if(variant&2)rank=9-rank;target.put({type:piece.type,color:variant&2?(piece.color==='w'?'b':'w'):piece.color},String.fromCharCode(97+file)+rank);}
  return target.fen().replace(' w ',variant&2?' b ':' w ');
}
function uci(move){return move.from+move.to+(move.promotion||'');}
function play(chess,move){return chess.move({from:move.slice(0,2),to:move.slice(2,4),...(move[4]?{promotion:move[4]}:{})});}
const engine=new Stockfish(),items=[];
const mateCache=new Map();
async function matingLines(fen,plies){
  const key=fen+'|'+plies;if(mateCache.has(key))return mateCache.get(key);
  const chess=new Chess(fen),side=chess.turn(),memo=new Map();let visited=0;
  function forced(remaining){
    if(chess.isCheckmate())return chess.turn()!==side;
    if(!remaining)return false;
    const key=remaining+'|'+chess.fen().split(' ').slice(0,4).join(' ');if(memo.has(key))return memo.get(key);
    if(++visited>2000000)throw Error('La comprobación exhaustiva del mate excedió el límite.');
    const attacking=chess.turn()===side,moves=chess.moves({verbose:true}).sort((a,b)=>Number(/[+#]/.test(b.san))-Number(/[+#]/.test(a.san)));
    if(!moves.length)return false;
    let result=!attacking;
    for(const move of moves){play(chess,uci(move));const wins=forced(remaining-1);chess.undo();if(attacking&&wins){result=true;break;}if(!attacking&&!wins){result=false;break;}}
    memo.set(key,result);return result;
  }
  async function branches(remaining,prefix){
    const lines=[];
    for(const move of chess.moves({verbose:true})){
      const encoded=uci(move);play(chess,encoded);
      if(forced(remaining-1)){
        if(chess.isCheckmate())lines.push([...prefix,encoded]);
        else{
          const reply=(await engine.search(chess.fen(),{nodes:200000})).move;play(chess,reply);
          lines.push(...await branches(remaining-2,[...prefix,encoded,reply]));chess.undo();
        }
      }
      chess.undo();
    }
    return lines;
  }
  const lines=await branches(plies,[]);if(!lines.length)throw Error('No se encontró mate forzado.');mateCache.set(key,lines);return lines;
}
async function add(kind,key,variant,difficulty,plies,extra=0){
  const [source,title,motif,objective,explanation]=bases[key];let fen=transform(source,variant);
  // Additional safe pawns create distinct back-rank and queen teaching compositions.
  if(extra){const c=new Chess(fen);const side=c.turn();const candidates='abcdefgh'.split('').map(file=>file+(side==='w'?'2':'7')).filter(square=>!c.get(square));c.put({type:'p',color:side},candidates[extra-1]);fen=c.fen();}
  const c=new Chess(fen),opposite=fen.replace(` ${c.turn()} `,` ${c.turn()==='w'?'b':'w'} `);
  if(new Chess(opposite).isCheck())throw Error('Composición ilegal: '+key);
  const best=await engine.search(fen,{nodes:200000});let solutions=[];
  if(plies===1&&motif==='mate'){
    for(const move of c.moves({verbose:true})){play(c,uci(move));if(c.isCheckmate())solutions.push([uci(move)]);c.undo();}
    if(!solutions.length)throw Error('No hay mate en una: '+key);
  }else if(motif==='mate'){
    // Prove every accepted first move against ALL legal defences, not just one PV.
    // The learner then faces the engine's chosen defence with all mating continuations.
    solutions=(await matingLines(source,plies)).map(line=>line.map(move=>transformMove(move,variant)));
  }else{
    const line=[];
    for(let i=0;i<(key==='opposition'?41:plies)&&!c.isGameOver();i++){
      if(key==='opposition'&&c.board().flat().some(p=>p?.color===new Chess(fen).turn()&&p.type==='q'))break;
      const next=i===0?best:await engine.search(c.fen(),{nodes:200000});
      // The discovered-check lesson deliberately cashes in its queen fork immediately.
      let move=next.move;
      if(key==='discovery'&&i===2){const capture=c.moves({verbose:true}).find(m=>m.captured==='q');if(!capture)throw Error('La dama escapó de la lección de ataque descubierto.');move=uci(capture);}
      play(c,move);line.push(move);
    }
    if(motif==='mate'&&!c.isCheckmate())throw Error('La secuencia no termina en mate: '+key+' '+line);
    if(key==='opposition'&&!c.board().flat().some(p=>p?.color===new Chess(fen).turn()&&p.type==='q'))throw Error('No coronó: '+line);
    solutions=[line];
  }
  const number=items.filter(x=>x.kind===kind).length+1;
  const suffix=['este','oeste','sur','norte'][variant]+(extra?' '+extra:'');
  items.push({id:(kind==='puzzle'?'p':'e')+String(number).padStart(2,'0'),kind,title:title+' · '+suffix,difficulty,motif,objective,explanation,fen,color:new Chess(fen).turn(),solutions,verification:{engine:'Stockfish 19',nodes:200000,evaluation:best.evaluation}});
}
function transformMove(move,variant){return [move.slice(0,2),move.slice(2,4)].map(s=>String.fromCharCode(97+((variant&1)?7-(s.charCodeAt(0)-97):s.charCodeAt(0)-97))+((variant&2)?9-Number(s[1]):s[1])).join('')+(move[4]||'');}
try{
  for(let i=0;i<6;i++)await add('puzzle','back',i%4,'easy',1,i>=4?i-3:0);
  for(let i=0;i<4;i++)await add('puzzle','queen',i,'easy',1);
  for(let i=0;i<3;i++)await add('puzzle','knight',i,'medium',3);
  for(let i=0;i<3;i++)await add('puzzle','pawn',i,'medium',3);
  for(let i=0;i<2;i++)await add('puzzle','discovery',i,'medium',3);
  for(let i=0;i<2;i++)await add('puzzle','pin',i,'medium',1);
  for(let i=0;i<4;i++)await add('puzzle','rook',i,'hard',3);
  for(let i=0;i<4;i++)await add('puzzle','ladder',i,'hard',3);
  for(let i=0;i<2;i++)await add('puzzle','rook3',i,'hard',5);
  for(let i=0;i<3;i++)await add('exercise','queen',i,'easy',1);
  for(let i=0;i<3;i++)await add('exercise','rook3',i,'hard',5);
  for(let i=0;i<3;i++)await add('exercise','opposition',i,'medium',9);
  for(let i=0;i<3;i++)await add('exercise','promotion',i,'easy',1);
  writeFileSync(new URL('../lib/training-catalog.json',import.meta.url),JSON.stringify(items,null,2)+'\n');
  console.log(`${items.length} composiciones comprobadas y guardadas.`);
}finally{engine.close();}
