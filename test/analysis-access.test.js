import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.js';

test('análisis API: privacidad, CSRF y bloqueo durante partidas humanas activas',async t=>{
  const app=createApp({database:':memory:',production:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const registered=await fetch(origin+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Analista',email:'analista@example.com',password:'contraseña suficientemente larga'})});
  const cookie=registered.headers.get('set-cookie').split(';')[0],account=await registered.json(),uid=account.user.id;
  app.db.prepare("INSERT INTO users(id,name) VALUES('other','Otro')").run();
  app.db.prepare("INSERT INTO games(id,white,black,status) VALUES('ABC123',?,'other','finished'),('DEF123','other','other','finished')").run(uid);
  async function request(id,{method='GET',csrf=account.csrf,body}={}){const response=await fetch(origin+'/api/analysis/'+id,{method,headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};}
  assert.equal((await request('ABC123')).body.status,'none');assert.equal((await request('DEF123')).status,404);
  assert.equal((await request('ABC123',{method:'POST',csrf:'wrong',body:{}})).status,403);
  assert.equal((await request('ABC123',{method:'POST',body:{}})).status,202);
  assert.equal(app.db.prepare('SELECT count(*) n FROM analyses').get().n,1);
  app.db.prepare("INSERT INTO games(id,white,black,status,kind) VALUES('LIVE12',?,'other','active','friend')").run(uid);
  assert.equal((await request('ABC123')).status,409);
  assert.equal((await request('ABC123',{method:'POST',body:{}})).status,409);
});
