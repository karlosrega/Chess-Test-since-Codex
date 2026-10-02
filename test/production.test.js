import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtempSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {createMailer} from '../lib/mail.js';
import {createApp} from '../server.js';
import {clientIP} from '../lib/client-ip.js';

async function smtpFixture(t){
  const messages=[],sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.write('220 localhost SMTP de prueba\r\n');
    let buffer='',data=false,body='';
    socket.on('data',chunk=>{buffer+=chunk.toString();while(buffer.includes('\r\n')){const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(data){if(line==='.') {messages.push(body);data=false;body='';socket.write('250 recibido\r\n');}else body+=line+'\n';continue;}
      if(/^EHLO/.test(line))socket.write('250-localhost\r\n250 SIZE 100000\r\n');
      else if(/^DATA/.test(line)){data=true;socket.write('354 continuar\r\n');}
      else if(/^QUIT/.test(line))socket.end('221 adiós\r\n');
      else if(/^STARTTLS/.test(line))socket.write('502 TLS no disponible en este servidor de prueba\r\n');
      else socket.write('250 ok\r\n');
    }});
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));});
  return {messages,env:{SMTP_HOST:'127.0.0.1',SMTP_PORT:String(server.address().port),SMTP_FROM:'chess@example.com'}};
}

test('SMTP real local: comprueba conexión y entrega mensaje sin exponer errores internos',async t=>{
  const {env,messages}=await smtpFixture(t),mailer=createMailer(env,{production:false});t.after(()=>mailer.close());
  await mailer.verify();await mailer.send({to:'qa@example.com',subject:'Prueba de recuperación',text:'Enlace sintético de QA'});
  assert.equal(messages.length,1);const content=messages[0].split('\n\n').slice(1).join('\n\n'),decoded=Buffer.from(content.replace(/=([A-F0-9]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16))),'latin1').toString('utf8');assert.match(decoded,/Enlace sintético de QA/);assert.match(messages[0],/qa@example.com/);
  await assert.rejects(mailer.send({to:'qa@example.com\r\nBcc: other@example.com',subject:'x',text:'x'}),/inválido/);
});

test('proxy: solo confía en una dirección explícita y rechaza cadenas falsificadas',()=>{
  const req={socket:{remoteAddress:'::ffff:172.30.42.2'},headers:{'x-forwarded-for':'203.0.113.20'}};
  assert.equal(clientIP(req,'172.30.42.2'),'203.0.113.20');assert.equal(clientIP(req,'172.30.42.3'),'172.30.42.2');
  req.headers['x-forwarded-for']='203.0.113.20, 198.51.100.1';assert.equal(clientIP(req,'172.30.42.2'),'172.30.42.2');
});

test('SMTP producción exige credenciales, TLS y direcciones válidas',async t=>{
  const {env}=await smtpFixture(t);
  assert.throws(()=>createMailer(env),/usuario y contraseña/);
  assert.throws(()=>createMailer({...env,SMTP_FROM:'bad\r\nBcc: extra'}),/dirección/);
  for(const address of ['chess,extra@example.com','chess;extra@example.com'])assert.throws(()=>createMailer({...env,SMTP_FROM:address}),/dirección/);
  assert.throws(()=>createMailer({...env,SMTP_PORT:'abc'}),/SMTP_PORT/);
  const mailer=createMailer({...env,SMTP_USER:'synthetic',SMTP_PASSWORD:'synthetic-secret'});t.after(()=>mailer.close());await assert.rejects(mailer.verify());
});

test('instancia única, recuperación de bloqueo obsoleto y cierre idempotente',async t=>{
  const path=join(mkdtempSync(join(tmpdir(),'chess-lock-')),'chess.sqlite');
  let app=createApp({database:path,production:false});assert.ok(existsSync(path+'.lock'));assert.throws(()=>createApp({database:path,production:false}),/otra instancia/);
  await Promise.all([app.close(),app.close()]);assert.equal(existsSync(path+'.lock'),false);
  writeFileSync(path+'.lock',JSON.stringify({pid:2147483647,host:hostname(),nonce:'stale'}));app=createApp({database:path,production:false});await app.close();
  writeFileSync(path+'.lock',JSON.stringify({pid:process.pid,host:'another-container',nonce:'foreign'}));assert.throws(()=>createApp({database:path,production:false}),/otro equipo o contenedor/);
  writeFileSync(path+'.lock',JSON.stringify({pid:process.pid,host:hostname(),nonce:'reused-pid'}));app=createApp({database:path,production:false});t.after(()=>app.close());assert.ok(existsSync(path+'.lock'));
});

test('preparación producción verifica SQLite y motor; readiness controla apertura del servicio',async t=>{
  const app=createApp({database:':memory:',production:true,publicUrl:'https://chess.example.com',sendMail:async()=>{}});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(origin+'/api/ready')).status,503);assert.equal((await fetch(origin+'/')).status,503);assert.equal((await fetch(origin+'/api/health')).status,200);
  await app.prepare();const response=await fetch(origin+'/api/ready');assert.equal(response.status,200);assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.equal((await fetch(origin+'/api/dev/mailbox')).status,404);
});

test('fallo de correo mantiene respuesta neutral y registra aviso sin filtrar secretos',async t=>{
  const messages=[],original=console.error;console.error=message=>messages.push(message);t.after(()=>console.error=original);
  const app=createApp({database:':memory:',production:false,sendMail:async()=>{throw Error('SECRET SMTP PASSWORD');}});t.after(()=>app.close());await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=(path,body)=>fetch(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  await request('/api/auth/register',{name:'Correo QA',email:'qa@example.com',password:'Contraseña sintética 2026'});
  const known=await request('/api/auth/forgot',{email:'qa@example.com'}),unknown=await request('/api/auth/forgot',{email:'unknown@example.com'});
  assert.equal(known.status,200);assert.deepEqual(await known.json(),await unknown.json());assert.deepEqual(messages,['No se pudo entregar un correo de recuperación.']);
});
