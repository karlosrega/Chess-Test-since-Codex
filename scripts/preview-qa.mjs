import {createApp} from '../server.js';
import {passwordHash} from '../lib/accounts.js';

// Isolated, disposable browser QA. Never points at the player's database.
const app=createApp({database:':memory:',production:false,publicUrl:null});
const password=await passwordHash('Jaque QA 2026 seguro!');
app.db.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('qa-user','Jugador de prueba','qa@example.com',password);
app.db.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run('qa-rival','Rival de prueba','rival@example.com',password);
app.server.listen(Number(process.env.QA_PORT||3001),process.env.HOST||'127.0.0.1',()=>console.log('QA aislado · cuenta sintética qa@example.com'));
app.server.on('error',async error=>{console.error('No se pudo iniciar QA:',error.message);await app.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
