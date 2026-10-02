import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,chmodSync,createReadStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {lockDatabase} from './database-lock.js';
import {SCHEMA_VERSION} from './database.js';

async function checksum(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}

export function inspectBackup(path){
  if(!existsSync(path))throw Error('La copia no existe.');
  const db=new DatabaseSync(path,{readOnly:true});
  try{const integrity=db.prepare('PRAGMA integrity_check').get().integrity_check;if(integrity!=='ok')throw Error('La copia no pasó integridad SQLite.');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('La copia contiene referencias inválidas.');return {schema:db.prepare('PRAGMA user_version').get().user_version,users:db.prepare('SELECT count(*) n FROM users').get().n,games:db.prepare('SELECT count(*) n FROM games').get().n};}finally{db.close();}
}
export async function createBackup(source,destination){
  source=resolve(source);destination=resolve(destination);
  if(!existsSync(source))throw Error('La base de origen no existe.');if(source===destination)throw Error('Origen y destino deben ser distintos.');if(existsSync(destination))throw Error('El destino ya existe; elige otro nombre.');
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});
  const temporary=destination+'.'+randomBytes(8).toString('hex')+'.tmp',db=new DatabaseSync(source,{readOnly:true});
  try{
    await backup(db,temporary);
    const details=inspectBackup(temporary),sha256=await checksum(temporary);
    chmodSync(temporary,0o600);renameSync(temporary,destination);
    const manifest={...details,sha256,created:new Date().toISOString()};writeFileSync(destination+'.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});return manifest;
  }finally{db.close();if(existsSync(temporary))unlinkSync(temporary);}
}
export async function restoreBackup(source,destination){
  source=resolve(source);destination=resolve(destination);
  if(source===destination)throw Error('Origen y destino deben ser distintos.');
  const manifest=JSON.parse(readFileSync(source+'.json','utf8'));
  if(await checksum(source)!==manifest.sha256)throw Error('Checksum de copia incorrecto. No se restauró nada.');
  const details=inspectBackup(source);if(details.schema>SCHEMA_VERSION||details.schema<1)throw Error('Esquema de copia incompatible.');
  mkdirSync(dirname(destination),{recursive:true,mode:0o700});const unlock=lockDatabase(destination);
  let prior=null,temporary=null;
  try{
    if(existsSync(destination)){prior=destination+'.before-restore-'+Date.now()+'.sqlite';await createBackup(destination,prior);}
    temporary=destination+'.restore-'+randomBytes(8).toString('hex')+'.tmp';
    // SQLite backup materializes all committed WAL data into a standalone file.
    const db=new DatabaseSync(source,{readOnly:true});try{await backup(db,temporary);}finally{db.close();}
    chmodSync(temporary,0o600);
    for(const suffix of ['-wal','-shm'])if(existsSync(destination+suffix))unlinkSync(destination+suffix);
    renameSync(temporary,destination);return {...details,previous:prior};
  }finally{if(temporary&&existsSync(temporary))unlinkSync(temporary);unlock();}
}
