import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000}).trim();
const suffix=Date.now(),name='chess-ci-'+suffix,data='chess-data-'+suffix,backups='chess-backups-'+suffix;
const image=process.env.QA_IMAGE||'jaque-royale:qa';
const volumes=['-v',data+':/app/data','-v',backups+':/app/backups'];
async function ready(){for(let i=0;i<100;i++){try{docker('exec',name,'node','-e',"fetch('http://127.0.0.1:3000/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");return;}catch{await new Promise(r=>setTimeout(r,200));}}throw Error('Contenedor no está preparado');}
const scenario=phase=>console.log(docker('exec',name,'node','scripts/container-scenario.mjs',phase));
try{
  docker('run','-d','--name',name,'--init','--read-only','--tmpfs','/tmp:size=64m','--memory','1g','--cpus','2','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges:true',...volumes,image,'node','scripts/container-qa.mjs');
  await ready();scenario('seed');docker('stop','--time','30',name);assert.equal(docker('inspect','--format','{{.State.ExitCode}}',name),'0');
  await new Promise(r=>setTimeout(r,1500));docker('start',name);await ready();scenario('resume');
  console.log(docker('exec',name,'node','scripts/backup.mjs','/app/data/chess.sqlite','/app/backups/live.sqlite'));
  scenario('mutate');docker('stop','--time','30',name);
  console.log(docker('run','--rm',...volumes,image,'node','scripts/restore.mjs','/app/backups/live.sqlite','/app/data/chess.sqlite','--offline'));
  docker('start',name);await ready();scenario('restored');docker('kill',name);docker('start',name);await ready();scenario('restored');
  console.log('PASS Docker: UID1000, volumen, solo lectura, SIGTERM, SIGKILL, recuperación, backup en caliente y restauración. Transporte SMTP sintético; no prueba correo externo.');
}catch(error){try{console.error(docker('logs',name));}catch{}throw error;}
finally{try{docker('rm','-f',name);}catch{}for(const volume of [data,backups])try{docker('volume','rm',volume);}catch{}}
