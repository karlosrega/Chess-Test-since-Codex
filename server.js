import http from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer, WebSocket } from 'ws';
import { Chess } from 'chess.js';

export function createApp({ database = 'data/chess.sqlite' } = {}) {
  if (database !== ':memory:') mkdirSync(resolve(database, '..'), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, token TEXT UNIQUE, name TEXT UNIQUE COLLATE NOCASE, rating INTEGER DEFAULT 1200, points REAL DEFAULT 0, played INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, white TEXT REFERENCES users(id), black TEXT REFERENCES users(id), pgn TEXT DEFAULT '', status TEXT DEFAULT 'waiting', result TEXT, reason TEXT, offer TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, finished TEXT);
    CREATE TABLE IF NOT EXISTS ratings(game TEXT REFERENCES games(id), user TEXT REFERENCES users(id), before INTEGER, after INTEGER, PRIMARY KEY(game,user));`);
  const sockets = new Set();
  const engines = new Map();
  const hash = token => createHash('sha256').update(token).digest('hex');
  const user = id => db.prepare('SELECT id,name,rating,points,played FROM users WHERE id=?').get(id);
  const game = id => db.prepare('SELECT * FROM games WHERE id=?').get(id);
  function engine(g) {
    if (!engines.has(g.id)) { const c = new Chess(); if (g.pgn) c.loadPgn(g.pgn); engines.set(g.id, c); }
    return engines.get(g.id);
  }
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  const online = id => [...sockets].some(s => s.uid === id);
  function state(g) {
    const c = engine(g);
    return { id:g.id, white:user(g.white), black:g.black ? user(g.black) : null, status:g.status, result:g.result, reason:g.reason, offer:g.offer, fen:c.fen(), board:c.board(), turn:c.turn(), check:c.isCheck(), moves:c.history(), legal:c.moves({verbose:true}).map(m => ({from:m.from,to:m.to,promotion:m.promotion})), online:{white:online(g.white),black:online(g.black)} };
  }
  function broadcast(id) { const g = game(id); if (g) for (const s of sockets) if (s.room === id) send(s,{type:'game',game:state(g)}); }
  function finish(g, result, reason) {
    if (g.status !== 'active') throw Error('La partida no está activa.');
    const w=user(g.white), b=user(g.black), score=result==='1-0'?1:result==='0-1'?0:0.5;
    const delta=Math.round(32*(score-1/(1+10**((b.rating-w.rating)/400))));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE games SET status='finished',result=?,reason=?,offer=NULL,finished=CURRENT_TIMESTAMP WHERE id=?").run(result,reason,g.id);
      for (const [u,d,s] of [[w,delta,score],[b,-delta,1-score]]) {
        db.prepare('UPDATE users SET rating=rating+?,points=points+?,played=played+1 WHERE id=?').run(d,s,u.id);
        db.prepare('INSERT INTO ratings VALUES(?,?,?,?)').run(g.id,u.id,u.rating,u.rating+d);
      }
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  const assets = new Map(['index.html','app.js','style.css'].map(f => ['/'+(f==='index.html'?'':f), {body:readFileSync(new URL('./public/'+f,import.meta.url)),type:f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html'}]));
  const server=http.createServer((req,res) => {
    const url=new URL(req.url,'http://localhost');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");
    if(url.pathname==='/api/health') {res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"ok":true}');}
    const asset=assets.get(url.pathname); if (!asset) {res.writeHead(404);return res.end('No encontrado');}
    res.writeHead(200,{'Content-Type':asset.type+'; charset=utf-8'});res.end(asset.body);
  });
  const wss=new WebSocketServer({server,path:'/ws',maxPayload:4096});
  wss.on('connection',(ws,req) => {
    if(req.headers.origin) {try {if(new URL(req.headers.origin).host!==req.headers.host) return ws.close(1008,'Origen inválido');}catch{return ws.close(1008);}}
    sockets.add(ws); ws.alive=true;
    ws.on('pong',()=>ws.alive=true);
    ws.on('error',e=>console.error('Error WebSocket:',e.message));
    ws.on('close',()=>{sockets.delete(ws);if(ws.room)broadcast(ws.room);});
    ws.on('message',raw=> {
      try {
        const now=Date.now(); if(!ws.window || now-ws.window>1000){ws.window=now;ws.count=0;} if(++ws.count>20) throw Error('Demasiadas solicitudes.');
        const m=JSON.parse(raw.toString());
        if(m.type==='hello') {
          if(ws.uid) throw Error('Ya estás identificado.');
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
        if(m.type==='stats') {
          send(ws,{type:'stats',user:user(ws.uid),leaders:db.prepare('SELECT name,rating,points,played FROM users ORDER BY rating DESC,played DESC LIMIT 10').all(),history:db.prepare(`SELECT g.id,w.name white,b.name black,g.result,g.reason,g.finished,r.before,r.after FROM games g JOIN users w ON w.id=g.white JOIN users b ON b.id=g.black JOIN ratings r ON r.game=g.id AND r.user=? ORDER BY g.finished DESC LIMIT 20`).all(ws.uid)});return;
        }
        if(m.type==='create'||m.type==='join') {
          if(db.prepare("SELECT id FROM games WHERE (white=? OR black=?) AND status IN ('waiting','active')").get(ws.uid,ws.uid)) throw Error('Ya tienes una sala abierta.');
          let id;
          if(m.type==='create') { do {id=randomBytes(3).toString('hex').toUpperCase();}while(game(id)); db.prepare('INSERT INTO games(id,white) VALUES(?,?)').run(id,ws.uid); }
          else {id=String(m.code||'').trim().toUpperCase(); const g=game(id);if(!g||g.status!=='waiting'||g.white===ws.uid) throw Error('La sala no está disponible.');db.prepare("UPDATE games SET black=?,status='active' WHERE id=?").run(ws.uid,id);}
          ws.room=id; broadcast(id);return;
        }
        const g=game(ws.room); if(!g||![g.white,g.black].includes(ws.uid)) throw Error('No perteneces a esta partida.');
        if(m.type==='cancel'&&g.status==='waiting') {db.prepare("UPDATE games SET status='cancelled' WHERE id=?").run(g.id);broadcast(g.id);return;}
        if(g.status!=='active') throw Error('La partida no está activa.');
        if(m.type==='move') {
          const c=engine(g), color=g.white===ws.uid?'w':'b';if(c.turn()!==color) throw Error('Es el turno de tu rival.');
          const move=c.move({from:m.from,to:m.to,promotion:m.promotion||'q'});if(!move) throw Error('Movimiento inválido.');
          db.prepare('UPDATE games SET pgn=?,offer=NULL WHERE id=?').run(c.pgn(),g.id);
          if(c.isGameOver()) finish(g,c.isCheckmate()?(color==='w'?'1-0':'0-1'):'1/2-1/2',c.isCheckmate()?'Jaque mate':'Tablas por reglas');
        } else if(m.type==='resign') finish(g,g.white===ws.uid?'0-1':'1-0','Rendición');
        else if(m.type==='draw') {if(g.offer&&g.offer!==ws.uid) finish(g,'1/2-1/2','Tablas acordadas');else db.prepare('UPDATE games SET offer=? WHERE id=?').run(ws.uid,g.id);}
        else throw Error('Acción desconocida.');
        broadcast(g.id);
      } catch(e) {send(ws,{type:'error',message:e instanceof SyntaxError?'Mensaje inválido.':e.message.startsWith('Invalid move')?'Movimiento inválido.':e.message});}
    });
  });
  const heartbeat=setInterval(()=>{for(const ws of sockets){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},30000);
  return {server,db,close:async()=>{clearInterval(heartbeat);for(const s of sockets)s.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));db.close();}};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createApp(); const port=Number(process.env.PORT||3000);
  app.server.listen(port,'0.0.0.0',()=>console.log(`Ajedrez listo: http://localhost:${port}`));
  app.server.on('error',e=>{console.error('Error del servidor:',e.message);process.exitCode=1;});
}
