import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const DAY = 86400000;
const random = () => randomBytes(32).toString('hex');
export const hashToken = value => createHash('sha256').update(value).digest('hex');
const profile = (db, id) => db.prepare('SELECT id,name,email,rating,points,played FROM users WHERE id=?').get(id);

export async function passwordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function passwordMatches(password, encoded) {
  // A fixed dummy hash keeps nonexistent-user login on the same expensive path.
  const [, salt, digest] = (encoded || `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const key = await derive(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(digest, 'hex')) && Boolean(encoded);
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw Error('La contraseña debe tener entre 12 y 128 caracteres.');
  return value;
}
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw Error('Introduce un correo válido.');
  return email;
}
export async function readJSON(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(Error('Se requiere JSON.'), { status: 415 });
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Object.assign(Error('Solicitud demasiado grande.'), { status: 413 }); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error(); return body; }
  catch { throw Error('Solicitud JSON inválida.'); }
}

export function createAccounts(db, { production = false, publicUrl, sendMail, now = Date.now } = {}) {
  if (production && (!publicUrl?.startsWith('https://') || typeof sendMail!=='function')) throw Error('Producción requiere PUBLIC_URL con HTTPS y un transporte de correo.');
  const mailbox = [];
  const revocations = new Set();
  const rate = new Map();
  let pending=0;
  async function expensive(action){if(pending>=32)throw Object.assign(Error('El servicio está ocupado. Inténtalo en unos segundos.'),{status:503});pending++;try{return await action();}finally{pending--;}}
  const mail = sendMail || (async message => { mailbox.push({ ...message, date: new Date(now()).toISOString() }); if (mailbox.length > 100) mailbox.shift(); });
  const cookieName = production ? '__Host-chessSession' : 'chessSession';
  const cookie = (token, age = 7 * 86400) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${production ? '; Secure' : ''}`;
  function session(req) {
    const cookies = String(req.headers.cookie || '').split(';').map(s => s.trim());
    const token = cookies.find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const found = db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hashToken(token), now());
    return found ? { ...found, profile: profile(db, found.user) } : null;
  }
  function newSession(user, res) {
    const token = random(), csrf = random();
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token), user, csrf, now() + 7 * DAY);
    res.setHeader('Set-Cookie', cookie(token));
    return { user: profile(db, user), csrf };
  }
  const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  function trusted(req) {
    const origin = publicUrl ? new URL(publicUrl).origin : `http://${req.headers.host}`;
    return req.headers.origin === origin;
  }
  function limit(req, route) {
    const key = `${req.clientIP||req.socket.remoteAddress}:${route}`;
    const t = now();
    if (rate.size > 10000) for (const [k, v] of rate) if (t >= v.until) rate.delete(k);
    const bucket = rate.get(key);
    if (!bucket || t >= bucket.until) rate.set(key, { until: t + 15 * 60000, count: 1 });
    else if (++bucket.count > 30) throw Object.assign(Error('Demasiados intentos. Vuelve a intentarlo en 15 minutos.'), { status: 429 });
  }
  async function handle(req, res, pathname) {
    if (!pathname.startsWith('/api/auth/') && pathname !== '/api/dev/mailbox') return false;
    try {
      if (pathname === '/api/dev/mailbox') {
        const local = ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        const localHost = ['localhost','127.0.0.1','[::1]'].includes(new URL(`http://${req.headers.host}`).hostname);
        if (production || !local || !localHost || req.method !== 'GET') return json(res, 404, { error: 'No encontrado.' }), true;
        return json(res, 200, { messages: mailbox }), true;
      }
      const current = session(req);
      if (pathname === '/api/auth/session' && req.method === 'GET') return json(res, 200, current ? { user: current.profile, csrf: current.csrf } : { user: null }), true;
      if (req.method !== 'POST') return json(res, 405, { error: 'Método no permitido.' }), true;
      if (!trusted(req)) return json(res, 403, { error: 'Origen no permitido.' }), true;
      limit(req, pathname);
      const body = await readJSON(req);
      if (pathname === '/api/auth/register') {
        const email = emailAddress(body.email), password = validatePassword(body.password);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (!/^[\p{L}\p{N} _-]{2,24}$/u.test(name)) throw Error('El nombre debe tener entre 2 y 24 letras o números.');
        const legacy = typeof body.legacyToken === 'string' ? db.prepare('SELECT * FROM users WHERE token=? AND email IS NULL').get(hashToken(body.legacyToken)) : null;
        const encoded = await expensive(()=>passwordHash(password));
        const id = legacy?.id || randomBytes(12).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          if (legacy) {
            const changed = db.prepare('UPDATE users SET name=?,email=?,password=?,token=NULL WHERE id=? AND email IS NULL AND token=?').run(name,email,encoded,id,hashToken(body.legacyToken));
            if (changed.changes !== 1) throw Error('La identidad de invitado ya se convirtió en cuenta. Inicia sesión.');
          }
          else db.prepare('INSERT INTO users(id,name,email,password) VALUES(?,?,?,?)').run(id,name,email,encoded);
          for (const mode of ['bullet','blitz','rapid']) db.prepare('INSERT OR IGNORE INTO mode_ratings(user,mode) VALUES(?,?)').run(id,mode);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); if (error.message.includes('UNIQUE')) throw Error('El nombre o correo ya está registrado.'); throw error; }
        json(res, 201, newSession(id, res));
      } else if (pathname === '/api/auth/login') {
        const email = emailAddress(body.email);
        if (typeof body.password !== 'string' || body.password.length > 128) throw Error('Credenciales incorrectas.');
        const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if (!await expensive(()=>passwordMatches(body.password,u?.password)) || !u || db.prepare('SELECT password FROM users WHERE id=?').get(u.id)?.password !== u.password) throw Object.assign(Error('Credenciales incorrectas.'), { status: 401 });
        json(res, 200, newSession(u.id, res));
      } else if (pathname === '/api/auth/logout') {
        if (!current || req.headers['x-csrf-token'] !== current.csrf) throw Object.assign(Error('Sesión o autorización inválida.'), { status: 403 });
        db.prepare('DELETE FROM sessions WHERE token=?').run(current.token);
        for (const notify of revocations) notify({ token:current.token });
        res.setHeader('Set-Cookie', cookie('', 0)); json(res, 200, { ok: true });
      } else if (pathname === '/api/auth/forgot') {
        const email = emailAddress(body.email), u = db.prepare('SELECT id,name FROM users WHERE email=?').get(email);
        // Use the same expensive path and do not wait for external SMTP delivery.
        await expensive(()=>passwordHash(random()));
        if (u) {
          const token = random();
          db.prepare('DELETE FROM password_resets WHERE user=?').run(u.id);
          db.prepare('INSERT INTO password_resets VALUES(?,?,?)').run(hashToken(token), u.id, now() + 30 * 60000);
          const origin = publicUrl || `http://${req.headers.host}`;
          Promise.resolve().then(()=>mail({ to: email, subject: 'Recupera tu cuenta de Jaque Royale', text: `Este enlace vence en 30 minutos: ${origin}/#reset?token=${token}` })).catch(()=>console.error('No se pudo entregar un correo de recuperación.'));
        }
        json(res, 200, { message: 'Si existe una cuenta con ese correo, recibirás un enlace para recuperar el acceso.' });
      } else if (pathname === '/api/auth/reset') {
        const password = validatePassword(body.password);
        if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw Error('Enlace inválido o vencido.');
        const encoded = await expensive(()=>passwordHash(password));
        let resetUser;
        db.exec('BEGIN IMMEDIATE');
        try {
          const reset = db.prepare('SELECT * FROM password_resets WHERE token=? AND expires>?').get(hashToken(body.token), now());
          if (!reset) throw Error('Enlace inválido o vencido.');
          db.prepare('UPDATE users SET password=? WHERE id=?').run(encoded, reset.user);
          db.prepare('DELETE FROM password_resets WHERE user=?').run(reset.user);
          db.prepare('DELETE FROM sessions WHERE user=?').run(reset.user);
          resetUser = reset.user;
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        for (const notify of revocations) notify({ user:resetUser });
        res.setHeader('Set-Cookie',cookie('',0)); json(res, 200, { ok: true });
      } else json(res, 404, { error: 'No encontrado.' });
    } catch (error) {
      const status = error.status || 400;
      // Never expose SQL errors, paths or stack traces to a browser.
      const message = /SQLITE|constraint|database/i.test(error.message) ? 'No se pudo completar la solicitud.' : error.message;
      json(res, status, { error: message });
    }
    return true;
  }
  return { handle, session, mailbox, onRevoke:callback=>{revocations.add(callback);return()=>revocations.delete(callback);}, cleanup:()=>{
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
    db.prepare('DELETE FROM password_resets WHERE expires<=?').run(now());
    for(const [key,value] of rate) if(now()>=value.until) rate.delete(key);
  } };
}
