import { mkdir, readFile, writeFile, readdir, stat, chmod,rename,rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, join } from 'node:path';

const execute=promisify(execFile);
const artifacts={
  'win32-x64':['stockfish-windows-x86-64-universal.zip','3c8bf1f9ea66a09350a40df4f632288285ac206d99f33ab5842c408fc30b48a7'],
  'win32-arm64':['stockfish-windows-arm64-universal.zip','8372ad3f0d7276deb2c70f801f541ec7db463219fc6d9c7592864e542aa4f401'],
  'linux-x64':['stockfish-linux-x86-64-universal.tar.gz','9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f'],
  'linux-arm64':['stockfish-linux-arm64-universal.tar.gz','fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01'],
};
const artifact=artifacts[`${process.platform}-${process.arch}`];
if(!artifact)throw Error('Plataforma no soportada por el instalador; configura STOCKFISH_PATH con Stockfish 19.');
const [name,digest]=artifact,dir=resolve('engines/stockfish-19'),archive=join(dir,name);
await mkdir(dir,{recursive:true});
const hash=createHash('sha256');let downloaded=false;
try{await stat(archive);}catch{downloaded=true;}
if(downloaded){
  console.log('Descargando Stockfish 19 desde su distribución oficial…');
  const response=await fetch(`https://github.com/official-stockfish/Stockfish/releases/download/sf_19/${name}`,{signal:AbortSignal.timeout(180000)});
  if(!response.ok||!response.body)throw Error(`Descarga fallida: HTTP ${response.status}`);
  let size=0;
  const partial=archive+'.part';
  // Remove only the known temporary download; never extract an interrupted archive.
  await rm(partial,{force:true});
  try{
    await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>100000000)return callback(Error('Archivo supera el tamaño esperado.'));callback(null,chunk);}}),createWriteStream(partial,{flags:'wx'}));
    const downloadedHash=createHash('sha256');await pipeline(createReadStream(partial),new Transform({transform(chunk,encoding,callback){downloadedHash.update(chunk);callback();}}));
    if(downloadedHash.digest('hex')!==digest)throw Error('Checksum incorrecto. No se ejecutará ni extraerá este archivo.');
    await rename(partial,archive);
  }catch(error){await rm(partial,{force:true});throw error;}
}
await pipeline(createReadStream(archive),new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback();}}));
if(hash.digest('hex')!==digest)throw Error('Checksum incorrecto. No se ejecutará ni extraerá este archivo. Retira la descarga y vuelve a instalar.');
await execute('tar',['-xf',archive,'-C',dir],{windowsHide:true,maxBuffer:1024*1024});
async function findExecutable(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory()){const found=await findExecutable(path);if(found)return found;}
    else if(process.platform==='win32'?/^stockfish.*\.exe$/i.test(entry.name):/^stockfish-[\w-]+$/.test(entry.name))return path;
  }
}
const executable=await findExecutable(dir);if(!executable)throw Error('No se encontró el ejecutable en la distribución.');
if(process.platform!=='win32')await chmod(executable,0o755);
await writeFile(resolve('engines/manifest.json'),JSON.stringify({version:'19',release:'sf_19',sha256:digest,executable:relative(resolve('.'),executable),source:'https://github.com/official-stockfish/Stockfish/tree/sf_19',license:'GPL-3.0'},null,2));
console.log(`Motor instalado y checksum verificado: ${relative(resolve('.'),executable)}`);
