import {openSync,writeFileSync,readFileSync,closeSync,unlinkSync,realpathSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hostname} from 'node:os';

const held=new Set();

/** Matchmaking and job ownership require exactly one application process per DB. */
export function lockDatabase(path){
  if(path===':memory:')return ()=>{};
  const file=(existsSync(path)?realpathSync(path):resolve(path))+'.lock';
  const host=hostname(),record=JSON.stringify({pid:process.pid,host,nonce:randomBytes(16).toString('hex')});
  for(let attempt=0;attempt<2;attempt++){
    try{const descriptor=openSync(file,'wx',0o600);try{writeFileSync(descriptor,record);}finally{closeSync(descriptor);}held.add(file);return ()=>{held.delete(file);try{if(readFileSync(file,'utf8')===record)unlinkSync(file);}catch{}};}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      let prior;try{prior=JSON.parse(readFileSync(file,'utf8'));}catch{throw Error('Bloqueo de base inválido. Comprueba que no haya otro proceso antes de retirarlo.');}
      if(!Number.isInteger(prior.pid)||prior.pid<1)throw Error('Bloqueo de base inválido.');
      // A PID from another container namespace cannot establish whether it is alive.
      if(prior.host!==host)throw Error('La base tiene un bloqueo de otro equipo o contenedor. Comprueba que esté detenido antes de retirar el bloqueo.');
      if(prior.pid===process.pid&&!held.has(file)){unlinkSync(file);continue;}
      try{process.kill(prior.pid,0);}catch(error){if(error.code==='ESRCH'){unlinkSync(file);continue;}}
      throw Error('Ya hay otra instancia utilizando esta base de datos.');
    }
  }
  throw Error('No se pudo adquirir el bloqueo de la base de datos.');
}
