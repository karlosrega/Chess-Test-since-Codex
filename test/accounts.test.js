import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
import { hashToken, createAccounts } from '../lib/accounts.js';
import { openDatabase } from '../lib/database.js';

async function fixture(t) {
  const app = createApp({ database: ':memory:', production: false });
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, body, cookie, headers = {}) {
    const res = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0], headers: res.headers };
  }
  return { app, origin, request };
}
const credentials = { name: 'Ana Cuenta', email: 'ana@example.com', password: 'una contraseña suficientemente larga' };

test('cuentas: registro, sesión segura, login y logout con CSRF', async t => {
  const { request, app } = await fixture(t);
  const registration = await request('/api/auth/register',credentials);
  assert.equal(registration.status,201);
  assert.match(registration.headers.get('set-cookie'),/HttpOnly/);
  assert.match(registration.headers.get('set-cookie'),/SameSite=Lax/);
  assert.equal(registration.body.user.email,credentials.email);
  assert.equal('password' in registration.body.user,false);
  assert.equal(app.db.prepare('SELECT count(*) n FROM mode_ratings').get().n,3);
  assert.match(app.db.prepare('SELECT password FROM users').get().password,/^scrypt:/);
  assert.equal((await request('/api/auth/session',undefined,registration.cookie)).body.user.name,credentials.name);
  assert.equal((await request('/api/auth/logout',{},registration.cookie)).status,403);
  assert.equal((await request('/api/auth/logout',{},registration.cookie, { 'x-csrf-token': registration.body.csrf })).status,200);
  assert.equal((await request('/api/auth/session',undefined,registration.cookie)).body.user,null);
  assert.equal((await request('/api/auth/login',{ ...credentials, password: 'incorrecta' })).status,401);
  assert.equal((await request('/api/auth/login',credentials)).status,200);
});

test('recuperación: respuesta neutra, enlace único y revocación de sesiones', async t => {
  const { app, request } = await fixture(t);
  const registered = await request('/api/auth/register',credentials);
  const existing = await request('/api/auth/forgot',{email:credentials.email});
  const absent = await request('/api/auth/forgot',{email:'nadie@example.com'});
  assert.deepEqual(existing.body,absent.body);
  assert.equal(app.accounts.mailbox.length,1);
  const token = app.accounts.mailbox[0].text.match(/token=([a-f0-9]+)/)[1];
  assert.notEqual(app.db.prepare('SELECT token FROM password_resets').get().token,token);
  const next = 'una nueva contraseña muy larga';
  assert.equal((await request('/api/auth/reset',{token,password:next})).status,200);
  assert.equal((await request('/api/auth/reset',{token,password:next})).status,400);
  assert.equal((await request('/api/auth/session',undefined,registered.cookie)).body.user,null);
  assert.equal((await request('/api/auth/login',credentials)).status,401);
  assert.equal((await request('/api/auth/login',{...credentials,password:next})).status,200);
});

test('recuperación rechaza tokens vencidos y registro valida entradas y origen', async t => {
  const { app, request } = await fixture(t);
  assert.equal((await request('/api/auth/register',{...credentials,password:'corta'})).status,400);
  assert.equal((await request('/api/auth/register',credentials,undefined,{Origin:'http://evil.test'})).status,403);
  await request('/api/auth/register',credentials);
  await request('/api/auth/forgot',{email:credentials.email});
  const token = app.accounts.mailbox[0].text.match(/token=([a-f0-9]+)/)[1];
  app.db.prepare('UPDATE password_resets SET expires=0').run();
  assert.equal((await request('/api/auth/reset',{token,password:credentials.password})).status,400);
  assert.equal((await request('/api/auth/register',credentials)).status,400);
  assert.equal((await request('/api/auth/session')).headers.get('cache-control'),'no-store');
});

test('invitado convertido conserva ID, partidas y puntuación, revoca token anterior', async t => {
  const { app, request } = await fixture(t);
  const token = 'a'.repeat(64);
  app.db.prepare('INSERT INTO users(id,token,name,rating,points,played) VALUES(?,?,?,?,?,?)').run('legacy',hashToken(token),'Ana anterior',1300,8,10);
  app.db.prepare('INSERT INTO games(id,white) VALUES(?,?)').run('OLD123','legacy');
  const registered = await request('/api/auth/register',{...credentials,legacyToken:token});
  assert.equal(registered.status,201);
  assert.equal(registered.body.user.id,'legacy');
  assert.equal(registered.body.user.rating,1300);
  assert.equal(registered.body.user.played,10);
  assert.equal(app.db.prepare('SELECT white FROM games').get().white,'legacy');
  assert.equal(app.db.prepare('SELECT token FROM users').get().token,null);
});

test('WebSocket reconoce sesión HTTP y rechaza acciones después de logout', async t => {
  const { origin, request } = await fixture(t);
  const registered = await request('/api/auth/register',credentials);
  const ws = new WebSocket(origin.replace('http:','ws:')+'/ws',{headers:{Cookie:registered.cookie,Origin:origin}});
  const hello = await new Promise((resolve,reject)=> { ws.once('message',raw=>resolve(JSON.parse(raw))); ws.once('error',reject); });
  assert.equal(hello.type,'hello'); assert.equal(hello.user.name,credentials.name);
  const closed = new Promise(resolve=>ws.once('close',resolve));
  await request('/api/auth/logout',{},registered.cookie,{'x-csrf-token':registered.body.csrf});
  assert.equal(await closed,1008);
});

test('conversión concurrente no permite apropiarse de una cuenta recién convertida', async t => {
  const {app,request}=await fixture(t),token='b'.repeat(64);
  app.db.prepare('INSERT INTO users(id,token,name) VALUES(?,?,?)').run('race',hashToken(token),'Invitado Race');
  const responses=await Promise.all([
    request('/api/auth/register',{name:'Primero',email:'primero@example.com',password:credentials.password,legacyToken:token}),
    request('/api/auth/register',{name:'Segundo',email:'segundo@example.com',password:credentials.password,legacyToken:token}),
  ]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,400]);
  assert.equal(app.db.prepare('SELECT count(*) n FROM sessions WHERE user=?').get('race').n,1);
  assert.equal(app.db.prepare('SELECT count(*) n FROM users').get().n,1);
});

test('API rechaza solicitudes excesivas, cuerpos malformados y lectura ajena', async t => {
  const {request,origin}=await fixture(t);
  assert.equal((await request('/api/stats')).status,401);
  const malformed=await fetch(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'null'});
  assert.equal(malformed.status,400);
  const oversized=await request('/api/auth/login',{email:'x'.repeat(9000)});
  assert.equal(oversized.status,413);
  for(let i=0;i<30;i++)await request('/api/auth/forgot',{email:'absent@example.com'});
  assert.equal((await request('/api/auth/forgot',{email:'absent@example.com'})).status,429);
});

test('migraciones conservan base antigua, generan copia y son idempotentes', () => {
  const dir = mkdtempSync(join(tmpdir(),'chess-migrations-')), path = join(dir,'old.sqlite');
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE users(id TEXT PRIMARY KEY,token TEXT UNIQUE,name TEXT UNIQUE COLLATE NOCASE,rating INTEGER DEFAULT 1200,points REAL DEFAULT 0,played INTEGER DEFAULT 0); INSERT INTO users(id,name) VALUES('old','Jugador anterior');");
  old.close();
  const migrated = openDatabase(path);
  assert.equal(migrated.prepare('SELECT name FROM users').get().name,'Jugador anterior');
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version,5);
  assert.equal(readdirSync(dir).filter(f=>f.endsWith('.bak')).length,1);
  migrated.close();
  const again = openDatabase(path); again.close();
  assert.equal(readdirSync(dir).filter(f=>f.endsWith('.bak')).length,1);
});

test('producción falla sin HTTPS o transporte de correo', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(()=>createAccounts(db,{production:true}),/Producción requiere/);
    assert.throws(()=>createAccounts(db,{production:true,publicUrl:'http://chess.test',sendMail:async()=>{}}),/HTTPS/);
  } finally { db.close(); }
});
