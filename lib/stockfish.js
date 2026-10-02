import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chess.js';

export function stockfishPath(){
  if(process.env.STOCKFISH_PATH)return resolve(process.env.STOCKFISH_PATH);
  const manifest=new URL('../engines/manifest.json',import.meta.url);
  if(!existsSync(manifest))return null;
  const installed=JSON.parse(readFileSync(manifest,'utf8'));
  return resolve(installed.executable);
}

export class Stockfish {
  constructor({path=stockfishPath(),args=[],timeout=30000,hash=32,onExit=()=>{}}={}){
    this.path=path;this.args=args;this.timeout=timeout;this.hash=hash;this.onExit=onExit;
    this.chain=Promise.resolve();this.pending=0;this.closed=false;
  }
  write(command){if(!this.process?.stdin.writable)throw Error('El motor no está disponible.');this.process.stdin.write(command+'\n');}
  wait(predicate,command){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiter=null;this.process?.kill();this.process=null;this.ready=false;reject(Error('Stockfish excedió el tiempo de respuesta.'));},this.timeout);
      this.waiter={predicate,resolve:line=>{clearTimeout(timer);this.waiter=null;resolve(line);},reject:error=>{clearTimeout(timer);this.waiter=null;reject(error);}};
      try{this.write(command);}catch(error){this.waiter.reject(error);}
    });
  }
  ensure(){
    if(this.starting)return this.starting;
    this.starting=this.launch().finally(()=>{this.starting=null;});
    return this.starting;
  }
  async launch(){
    if(this.closed)throw Error('Motor cerrado.');
    if(this.process&&this.ready)return;
    if(!this.path||!existsSync(this.path))throw Error('Stockfish no está instalado. Ejecuta node scripts/install-engine.mjs.');
    const child=spawn(this.path,this.args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.process=child;this.name=null;
    child.stdin.on('error',()=>{});
    child.stderr.on('data',()=>{});
    const reader=createInterface({input:child.stdout});
    reader.on('line',line=>{
      if(line.length>65536){child.kill();return;}
      if(line.startsWith('id name '))this.name=line.slice(8);
      if(line.startsWith('info '))this.info?.(line);
      if(this.waiter?.predicate(line))this.waiter.resolve(line);
    });
    const failed=()=>{
      reader.close();
      if(this.process===child){this.process=null;this.ready=false;this.waiter?.reject(Error('El proceso Stockfish se detuvo.'));}
    };
    child.once('error',failed);child.once('exit',failed);
    child.once('exit',()=>this.onExit(child.pid));
    await this.wait(line=>line==='uciok','uci');
    if(!/^Stockfish 19(?:\b|$)/.test(this.name||'')){child.kill();this.process=null;throw Error('Se requiere la versión fija Stockfish 19.');}
    this.write('setoption name Threads value 1');this.write(`setoption name Hash value ${this.hash}`);
    await this.wait(line=>line==='readyok','isready');
    this.ready=true;
  }
  search(fen,{nodes=200000,skill=20,searchMoves=[]}={}){
    try{
      const chess=new Chess(fen);
      // An opponent already in check is not a legal position for this side to move.
      if(new Chess(fen.replace(` ${chess.turn()} `,` ${chess.turn()==='w'?'b':'w'} `)).isCheck())throw Error('Posición ilegal.');
      if(typeof fen!=='string'||/[\r\n]/.test(fen)||!Number.isInteger(nodes)||nodes<1||nodes>10000000||!Number.isInteger(skill)||skill<0||skill>20||!Array.isArray(searchMoves)||searchMoves.some(m=>!/^([a-h][1-8]){2}[qrbn]?$/.test(m)))throw Error('Parámetros de motor inválidos.');
    }catch(error){return Promise.reject(Error('Posición o parámetros de motor inválidos.'));}
    if(this.closed)return Promise.reject(Error('Motor cerrado.'));
    if(this.pending>=64)return Promise.reject(Error('El motor está ocupado. Inténtalo de nuevo.'));
    this.pending++;
    const task=async()=>{
      try{
        await this.ensure();
        this.write('ucinewgame');this.write(`setoption name Skill Level value ${skill}`);
        await this.wait(line=>line==='readyok','isready');
        let evaluation=null,depth=0,pv=[];
        this.info=line=>{
          if(/\bmultipv\s+[2-9]/.test(line)||/\b(lowerbound|upperbound)\b/.test(line))return;
          const score=line.match(/\bscore (cp|mate) (-?\d+)/),d=line.match(/\bdepth (\d+)/),variation=line.match(/\bpv (.+)$/);
          if(score)evaluation={type:score[1],value:Number(score[2])};
          if(d)depth=Number(d[1]);if(variation)pv=variation[1].trim().split(/\s+/);
        };
        this.write(`position fen ${fen}`);
        const best=await this.wait(line=>line.startsWith('bestmove '),`go nodes ${nodes}${searchMoves.length?' searchmoves '+searchMoves.join(' '):''}`);
        const move=best.split(/\s+/)[1];
        return {move:move==='(none)'||move==='0000'?null:move,evaluation,depth,pv,engine:this.name};
      }finally{this.info=null;this.pending--;}
    };
    const result=this.chain.then(task,task);this.chain=result.catch(()=>{});return result;
  }
  close(){this.closed=true;this.ready=false;this.waiter?.reject(Error('Motor cerrado.'));try{this.process?.stdin.write('quit\n');}catch{}this.process?.kill();this.process=null;}
}
