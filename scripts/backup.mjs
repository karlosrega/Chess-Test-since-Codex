import {createBackup} from '../lib/backups.js';
const [source=process.env.DATABASE_PATH||'data/chess.sqlite',destination]=process.argv.slice(2);
try{if(!destination)throw Error('Uso: node scripts/backup.mjs data/chess.sqlite backups/fecha.sqlite');console.log(JSON.stringify(await createBackup(source,destination),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
