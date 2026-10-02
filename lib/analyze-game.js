import {Chess} from 'chess.js';

export function scoreCP(score){
  if(!score)throw Error('El motor no devolvió evaluación.');
  if(score.type==='cp')return score.value;
  return score.value>0?100000-score.value:score.value<0?-100000-score.value:-100000;
}
export function classifyLoss(loss,lostMate=false){return lostMate||loss>=200?'grave':loss>=100?'error':loss>=50?'imprecisión':'correcta';}
export function precision(losses){return losses.length?Math.round(10000*Math.exp(-0.004*losses.reduce((sum,n)=>sum+Math.min(1000,n),0)/losses.length))/100:null;}
function whiteScore(score,color){return {...score,value:score.value*(color==='w'?1:-1)};}

export async function analyzePGN(pgn,engine,{nodes=200000,onProgress=()=>{}}={}){
  const c=new Chess();if(pgn)c.loadPgn(pgn);
  const history=c.history({verbose:true}),moves=[],losses={w:[],b:[]};
  for(let i=0;i<history.length;i++){
    const m=history[i],played=m.from+m.to+(m.promotion||'');
    const best=await engine.search(m.before,{nodes,skill:20});
    const actual=best.move===played?best:await engine.search(m.before,{nodes,skill:20,searchMoves:[played]});
    const lostMate=best.evaluation?.type==='mate'&&best.evaluation.value>0&&!(actual.evaluation?.type==='mate'&&actual.evaluation.value>0);
    const loss=Math.min(1000,Math.max(0,scoreCP(best.evaluation)-scoreCP(actual.evaluation)));
    losses[m.color].push(loss);
    moves.push({ply:i+1,san:m.san,color:m.color,from:m.from,to:m.to,before:m.before,after:m.after,bestMove:best.move,loss,lostMate,label:classifyLoss(loss,lostMate),beforeEval:whiteScore(best.evaluation,m.color),afterEval:whiteScore(actual.evaluation,m.color),pv:best.pv.slice(0,8)});
    onProgress(Math.round(100*(i+1)/history.length));
  }
  return {engine:'Stockfish 19',nodes,metric:'Jaque Royale · precisión aproximada por pérdida de evaluación',whitePrecision:precision(losses.w),blackPrecision:precision(losses.b),initialFen:history[0]?.before||c.fen(),moves};
}
