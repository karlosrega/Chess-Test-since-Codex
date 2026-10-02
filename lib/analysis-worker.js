import {parentPort,workerData} from 'node:worker_threads';
import {Stockfish} from './stockfish.js';
import {analyzePGN} from './analyze-game.js';

let busy=false,closing=false;
const engine=new Stockfish({path:workerData.path,onExit:pid=>{if(!closing)parentPort.postMessage({type:'engineExit',pid});}});
parentPort.on('message',async message=>{
  if(message.type==='close'){closing=true;engine.close();parentPort.close();return;}
  if(message.type!=='analyze'||busy||closing)return;
  busy=true;
  try{
    if(message.pgn){await engine.ensure();parentPort.postMessage({type:'enginePid',id:message.id,pid:engine.process.pid});}
    const result=await analyzePGN(message.pgn,engine,{nodes:workerData.nodes,onProgress:progress=>{if(!closing)parentPort.postMessage({type:'progress',id:message.id,progress});}});
    if(!closing)parentPort.postMessage({type:'done',id:message.id,result});
  }catch(error){if(!closing)parentPort.postMessage({type:'failed',id:message.id,error:'No se pudo completar el análisis. Puedes reintentarlo.'});}
  finally{busy=false;}
});
