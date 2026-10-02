import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { openDatabase } from './lib/database.js';
import { createAccounts, readJSON } from './lib/accounts.js';
import { statisticsFor, historyFor } from './lib/statistics.js';
import { WebSocketServer, WebSocket } from 'ws';
import { createGames } from './lib/games.js';
import { Stockfish } from './lib/stockfish.js';
import { createAnalyses } from './lib/analyses.js';
import {createTraining} from './lib/training.js';
import {createMailer} from './lib/mail.js';
import {lockDatabase} from './lib/database-lock.js';
import {clientIP} from './lib/client-ip.js';

export function createApp({ database = process.env.DATABASE_PATH||'data/chess.sqlite', production = process.env.NODE_ENV === 'production', publicUrl = process.env.PUBLIC_URL, sendMail, clock = Date.now,trustedProxy=process.env.TRUST_PROXY_IP } = {}) {
  if(publicUrl){const parsed=new URL(publicUrl);if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||!['http:','https:'].includes(parsed.protocol))throw Error('PUBLIC_URL debe ser un origen HTTP o HTTPS sin rutas ni credenciales.');publicUrl=parsed.origin;}
  if (database !== ':memory:') mkdirSync(resolve(database, '..'), { recursive: true });
  const unlock=lockDatabase(database);
  let db;
  try{db=openDatabase(database);}catch(error){unlock();throw error;}
  let accounts;
  try { accounts = createAccounts(db, { production, publicUrl, sendMail }); }
  catch(error) { db.close();unlock();throw error; }
  const training=createTraining(db);
  const trainingLimits=new Map();
  const requestLimits=new Map();
  const sockets = new Set();
  const botEngine=new Stockfish();
  const analyses=createAnalyses(db,{path:botEngine.path,onUpdate:(id,status)=>{
    const g=db.prepare('SELECT white,black FROM games WHERE id=?').get(id);
    if(g)for(const socket of sockets)if(socket.readyState===WebSocket.OPEN&&[g.white,g.black].includes(socket.uid))socket.send(JSON.stringify({type:'analysis',game:id,status:status.status,progress:status.progress,error:status.error}));
  }});
  accounts.onRevoke(({token,user:uid})=>{for(const socket of sockets)if(socket.sessionToken && (socket.sessionToken===token || socket.uid===uid))socket.close(1008,'Sesión revocada.');});
  const hash = token => createHash('sha256').update(token).digest('hex');
  const user = id => db.prepare('SELECT id,name,rating,points,played FROM users WHERE id=?').get(id);
  const send = (ws,data) => { if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const games=createGames(db,{
    now:clock,
    botMove:botEngine.path?(fen,options)=>botEngine.search(fen,options):null,
    onFinished:g=>analyses.enqueue(g.id),
    attach:(ids,id)=>{for(const socket of sockets)if(ids.includes(socket.uid))socket.room=id;},
    notify:(ids,message)=>{
      if(message.type==='game')message.game.online={white:Boolean(message.game.white)&&[...sockets].some(s=>s.uid===message.game.white.id),black:Boolean(message.game.black)&&[...sockets].some(s=>s.uid===message.game.black.id)};
      for(const socket of sockets)if(ids.includes(socket.uid) && (message.type!=='game' || socket.room===message.game.id))send(socket,message);
    },
  });
  const broadcast=id=>games.publish(id);
  const assets = new Map(['index.html','app.js','api.js','board.js','review.js','training.js','style.css'].map(f => ['/'+(f==='index.html'?'':f), {body:readFileSync(new URL('./public/'+f,import.meta.url)),type:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html'}]));
  let ready=!production,draining=false,closing=null;
  const handler=async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    req.clientIP=clientIP(req,trustedProxy);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(production) res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Content-Security-Policy',`default-src 'self'; connect-src 'self' ${publicUrl?publicUrl.replace(/^http/,'ws'):''}; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if(url.pathname==='/api/ready'){res.writeHead(ready&&!draining?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({ok:ready&&!draining}));}
    if(production&&!ready&&url.pathname!=='/api/health'){res.writeHead(503);return res.end('El servicio está iniciando.');}
    if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/health'){
      const now=Date.now(),limit=requestLimits.get(req.clientIP);if(!limit||now-limit.since>60000)requestLimits.set(req.clientIP,{since:now,count:0});
      if(++requestLimits.get(req.clientIP).count>300){res.writeHead(429,{'Content-Type':'application/json','Retry-After':'60'});return res.end(JSON.stringify({error:'Demasiadas solicitudes. Espera un minuto.'}));}
    }
    if(await accounts.handle(req,res,url.pathname)) return;
    if(url.pathname.startsWith('/api/training/')){
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
      const reply=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
      const current=accounts.session(req);
      const active=current&&games.open(current.user);
      if(active){const live=games.get(active.id);if(live.status==='active'&&live.kind!=='bot')return reply(409,{error:'Termina tu partida contra otra persona antes de entrenar.'});}
      if(url.pathname==='/api/training/catalog'&&req.method==='GET'){try{return reply(200,training.list(current?.user,url.searchParams.get('kind')));}catch(e){return reply(400,{error:e.message});}}
      if(!current)return reply(401,{error:'Inicia sesión para guardar tu entrenamiento.'});
      const runMatch=url.pathname.match(/^\/api\/training\/run\/([a-f0-9]{24})$/);
      if(runMatch&&req.method==='GET'){try{return reply(200,training.get(current.user,runMatch[1]));}catch{return reply(404,{error:'Intento no encontrado.'});}}
      if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
      const expected=publicUrl?new URL(publicUrl).origin:`http://${req.headers.host}`;
      if(req.headers.origin!==expected||req.headers['x-csrf-token']!==current.csrf)return reply(403,{error:'Autorización inválida.'});
      const now=Date.now(),limit=trainingLimits.get(current.user);
      if(!limit||now-limit.since>60000)trainingLimits.set(current.user,{since:now,count:0});
      if(++trainingLimits.get(current.user).count>120)return reply(429,{error:'Espera un minuto antes de continuar entrenando.'});
      try{
        const message=await readJSON(req);
        if(url.pathname==='/api/training/start'){
          if(typeof message.item!=='string'||(message.restart!==undefined&&typeof message.restart!=='boolean'))throw Error('Solicitud inválida.');
          return reply(200,training.start(current.user,message.item,{restart:message.restart}));
        }
        if(runMatch)return reply(200,training.action(current.user,runMatch[1],message));
        return reply(404,{error:'Ruta no encontrada.'});
      }catch(e){return reply(400,{error:e.message});}
    }
    const analysisMatch=url.pathname.match(/^\/api\/analysis\/([A-F0-9]{6})$/);
    if(analysisMatch){
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');
      const current=accounts.session(req),g=games.get(analysisMatch[1]);
      const reply=(status,body)=>{res.writeHead(status);res.end(JSON.stringify(body));};
      if(!current)return reply(401,{error:'Inicia sesión.'});
      if(!g||![g.white,g.black].includes(current.user))return reply(404,{error:'Partida no encontrada.'});
      if(g.status!=='finished')return reply(409,{error:'El análisis estará disponible al terminar.'});
      const active=games.open(current.user);if(active){const live=games.get(active.id);if(live.status==='active'&&live.kind!=='bot')return reply(409,{error:'Termina tu partida contra otra persona antes de abrir un análisis.'});}
      if(req.method==='GET')return reply(200,analyses.view(g.id));
      if(req.method!=='POST')return reply(405,{error:'Método no permitido.'});
      const expected=publicUrl?new URL(publicUrl).origin:`http://${req.headers.host}`;
      if(req.headers.origin!==expected||req.headers['x-csrf-token']!==current.csrf)return reply(403,{error:'Autorización inválida.'});
      try{await readJSON(req);return reply(202,analyses.enqueue(g.id,{retry:true}));}catch{return reply(400,{error:'No se pudo solicitar el análisis.'});}
    }
    if(url.pathname==='/api/stats' || url.pathname==='/api/history') {
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type','application/json; charset=utf-8');
      const current=accounts.session(req);
      if(!current){res.writeHead(401);return res.end(JSON.stringify({error:'Inicia sesión para ver tu progreso.'}));}
      if(req.method!=='GET'){res.writeHead(405);return res.end(JSON.stringify({error:'Método no permitido.'}));}
      const page=Number(url.searchParams.get('page')||1);
      if(!Number.isInteger(page)||page<1||page>100000){res.writeHead(400);return res.end(JSON.stringify({error:'Página inválida.'}));}
      return res.end(JSON.stringify(url.pathname==='/api/stats'?statisticsFor(db,current.user):historyFor(db,current.user,page)));
    }
    if(url.pathname==='/api/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
    const asset=assets.get(url.pathname); if (!asset) {res.writeHead(404);return res.end('No encontrado');}
    res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8','Cache-Control':'no-cache'});res.end(asset.body);
  };
  const server=http.createServer({requestTimeout:10000,headersTimeout:10000,keepAliveTimeout:5000},(req,res)=>{
    handler(req,res).catch(()=>{
      console.error('Error al atender una solicitud HTTP.');
      if(res.headersSent){res.destroy();return;}
      res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'No se pudo completar la solicitud.'}));
    });
  });
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:4096});
  server.maxConnections=512;
  wss.on('error',error=>console.error('Error del servidor WebSocket:',error.message));
  wss.on('connection',(ws,req) => {
    if(draining||!ready)return ws.close(1013,'Servicio iniciando.');
    req.clientIP=clientIP(req,trustedProxy);
    if(sockets.size>=256 || [...sockets].filter(s=>s.ip===req.clientIP).length>=8) return ws.close(1013,'Límite de conexiones alcanzado.');
    if(req.headers.origin) {try {if(publicUrl ? req.headers.origin !== new URL(publicUrl).origin : new URL(req.headers.origin).host!==req.headers.host) return ws.close(1008,'Origen inválido');}catch{return ws.close(1008);}}
    const accountSession = accounts.session(req);
    if(production&&!accountSession)return ws.close(1008,'Inicia sesión.');
    sockets.add(ws); ws.alive=true;ws.ip=req.clientIP;
    if(accountSession) {
      ws.sessionToken=accountSession.token;
      ws.sessionValid=()=>Boolean(accounts.session(req));
      ws.uid=accountSession.user;
      send(ws,{type:'hello',user:user(ws.uid)});
      const active=db.prepare("SELECT id FROM games WHERE (white=? OR black=?) AND status IN ('waiting','active') ORDER BY created DESC LIMIT 1").get(ws.uid,ws.uid);
      if(active){ws.room=active.id;broadcast(ws.room);}
    }
    ws.on('pong',()=>ws.alive=true);
    ws.on('error',e=>console.error('Error WebSocket:',e.message));
    ws.on('close',()=>{sockets.delete(ws);if(ws.uid && ![...sockets].some(s=>s.uid===ws.uid))games.cancelSearch(ws.uid,'desconexión');if(ws.room)broadcast(ws.room);});
    ws.on('message',raw=> {
      try {
        if(accountSession && !accounts.session(req)) return ws.close(1008,'Sesión vencida.');
        const now=Date.now(); if(!ws.window || now-ws.window>1000){ws.window=now;ws.count=0;} if(++ws.count>20) throw Error('Demasiadas solicitudes.');
        const m=JSON.parse(raw.toString());
        if(!m||typeof m!=='object'||Array.isArray(m)||typeof m.type!=='string')throw Error('Mensaje inválido.');
        if(m.type==='hello') {
          if(ws.uid) throw Error('Ya estás identificado.');
          if(production) throw Error('Inicia sesión con tu cuenta.');
          let u=typeof m.token==='string'?db.prepare('SELECT * FROM users WHERE token=?').get(hash(m.token)):null;
          let token=m.token;
          if(!u) {
            const name=String(m.name||'').trim(); if(!/^[\p{L}\p{N} _-]{2,24}$/u.test(name)) throw Error('El nombre debe tener entre 2 y 24 letras o números.');
            if(db.prepare('SELECT id FROM users WHERE name=?').get(name)) throw Error('Ese nombre ya está ocupado. Elige otro.');
            token=randomBytes(32).toString('hex'); const id=randomBytes(12).toString('hex');
            db.prepare('INSERT INTO users(id,token,name) VALUES(?,?,?)').run(id,hash(token),name); u=user(id);
          }
          ws.uid=u.id; send(ws,{type:'hello',token,user:user(u.id)});
          const active=db.prepare("SELECT id FROM games WHERE (white=? OR black=?) AND status IN ('waiting','active') ORDER BY created DESC LIMIT 1").get(u.id,u.id);
          if(active){ws.room=active.id;broadcast(ws.room);} return;
        }
        if(!ws.uid) throw Error('Primero introduce tu nombre.');
        if(m.type==='stats'){send(ws,{type:'stats',user:user(ws.uid),...statisticsFor(db,ws.uid),history:historyFor(db,ws.uid).rows});return;}
        games.handle(ws.uid,m);
      } catch(e) {send(ws,{type:'error',message:e instanceof SyntaxError?'Mensaje inválido.':e.message.startsWith('Invalid move')?'Movimiento inválido.':e.message});}
    });
  });
  const clockTimer=setInterval(()=>games.tick(),100);
  const heartbeat=setInterval(()=>{accounts.cleanup();for(const limits of [trainingLimits,requestLimits])for(const [id,limit] of limits)if(Date.now()-limit.since>60000)limits.delete(id);for(const ws of sockets){if(ws.sessionValid&&!ws.sessionValid()){ws.close(1008,'Sesión vencida.');continue;}if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},30000);
  return {server,db,accounts,games,botEngine,analyses,training,
    prepare:async()=>{if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('La base de datos no pasó la comprobación de integridad y referencias.');await botEngine.ensure();ready=true;},
    close:()=>closing||(closing=(async()=>{draining=true;ready=false;clearInterval(clockTimer);clearInterval(heartbeat);games.clear();botEngine.close();await analyses.close();for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));db.close();unlock();})()),
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  let app,mailer,stopping=false;
  const stop=async(code=0)=>{if(stopping)return;stopping=true;try{await app?.close();}finally{mailer?.close();process.exitCode=code;}};
  try{
    mailer=createMailer();app=createApp({sendMail:mailer?.send});
    const port=Number(process.env.PORT||3000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT inválido.');
    if(process.env.NODE_ENV==='production'){try{await mailer.verify();}catch{throw Error('No se pudo verificar SMTP. Revisa las credenciales, TLS y la conexión al proveedor.');}await app.prepare();}
    app.server.listen(port,process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1'),()=>console.log(`Jaque Royale listo en el puerto ${port}.`));
    app.server.on('error',async()=>{console.error('No se pudo iniciar el servidor HTTP.');await stop(1);});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>stop());
  }catch(error){console.error('Error de configuración o preparación:',error.message);await stop(1);}
}
