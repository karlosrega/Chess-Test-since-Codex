import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server.js';
import {openDatabase} from '../lib/database.js';
import {createBackup,restoreBackup,inspectBackup} from '../lib/backups.js';

test('copia en caliente incluye WAL, checksum y restauración conserva cuentas y progreso',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'chess-backup-')),path=join(dir,'live.sqlite'),copy=join(dir,'backup.sqlite');
  const app=createApp({database:path,production:false});
  app.db.prepare("INSERT INTO users(id,name) VALUES('qa','QA Backup')").run();app.db.prepare("INSERT INTO training_runs(id,user,item,status) VALUES('run','qa','p01','solved')").run();
  const manifest=await createBackup(path,copy);assert.equal(manifest.schema,5);assert.equal(manifest.users,1);assert.ok(existsSync(copy+'.json'));
  assert.equal(inspectBackup(copy).users,1);await assert.rejects(restoreBackup(copy,path),/otra instancia/);await app.close();
  const changed=openDatabase(path);changed.prepare("INSERT INTO users(id,name) VALUES('later','Más tarde')").run();changed.close();
  const restored=await restoreBackup(copy,path);assert.ok(existsSync(restored.previous));assert.equal(inspectBackup(restored.previous).users,2);
  const db=openDatabase(path);t.after(()=>db.close());assert.equal(db.prepare('SELECT count(*) n FROM users').get().n,1);assert.equal(db.prepare('SELECT status FROM training_runs').get().status,'solved');
});

test('migración conserva en su snapshot los datos confirmados aún dentro del WAL',()=>{
  const dir=mkdtempSync(join(tmpdir(),'chess-migration-wal-')),path=join(dir,'old.sqlite'),writer=new DatabaseSync(path);
  writer.exec("PRAGMA journal_mode=WAL;CREATE TABLE users(id TEXT PRIMARY KEY,token TEXT UNIQUE,name TEXT UNIQUE COLLATE NOCASE,rating INTEGER DEFAULT 1200,points REAL DEFAULT 0,played INTEGER DEFAULT 0);INSERT INTO users(id,name) VALUES('old','Último dato en WAL');");
  const migrated=openDatabase(path);migrated.close();writer.close();const snapshot=join(dir,readdirSync(dir).find(name=>name.endsWith('.bak'))),db=new DatabaseSync(snapshot,{readOnly:true});
  try{assert.equal(db.prepare('SELECT name FROM users').get().name,'Último dato en WAL');assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);}finally{db.close();}
});

test('copia rechaza relaciones inválidas aunque la estructura SQLite sea íntegra',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chess-backup-fk-')),path=join(dir,'live.sqlite'),copy=join(dir,'backup.sqlite'),db=openDatabase(path);
  db.exec("PRAGMA foreign_keys=OFF;INSERT INTO games(id,white) VALUES('BAD123','missing');");db.close();await assert.rejects(createBackup(path,copy),/referencias inválidas/);assert.equal(existsSync(copy),false);
});

test('copia alterada y destinos existentes se rechazan antes de modificar datos',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chess-backup-check-')),path=join(dir,'live.sqlite'),copy=join(dir,'backup.sqlite');const db=openDatabase(path);db.close();await createBackup(path,copy);
  await assert.rejects(createBackup(path,copy),/ya existe/);
  const original=readFileSync(path),manifest=JSON.parse(readFileSync(copy+'.json','utf8'));manifest.sha256='wrong';writeFileSync(copy+'.json',JSON.stringify(manifest));
  await assert.rejects(restoreBackup(copy,path),/Checksum/);assert.deepEqual(readFileSync(path),original);
});
