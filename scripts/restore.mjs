import {restoreBackup} from '../lib/backups.js';
const [source,destination=process.env.DATABASE_PATH||'data/chess.sqlite',confirmation]=process.argv.slice(2);
try{if(!source||confirmation!=='--offline')throw Error('Detén el servicio. Uso: node scripts/restore.mjs backups/fecha.sqlite data/chess.sqlite --offline');console.log(JSON.stringify(await restoreBackup(source,destination),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
