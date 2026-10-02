import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const migrations = [
  `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, token TEXT UNIQUE, name TEXT UNIQUE COLLATE NOCASE, rating INTEGER DEFAULT 1200, points REAL DEFAULT 0, played INTEGER DEFAULT 0);
   CREATE TABLE IF NOT EXISTS games(id TEXT PRIMARY KEY, white TEXT REFERENCES users(id), black TEXT REFERENCES users(id), pgn TEXT DEFAULT '', status TEXT DEFAULT 'waiting', result TEXT, reason TEXT, offer TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, finished TEXT);
   CREATE TABLE IF NOT EXISTS ratings(game TEXT REFERENCES games(id), user TEXT REFERENCES users(id), before INTEGER, after INTEGER, PRIMARY KEY(game,user));`,
  `ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE;
   ALTER TABLE users ADD COLUMN password TEXT;
   CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;
   CREATE TABLE sessions(token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
   CREATE TABLE password_resets(token TEXT PRIMARY KEY, user TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
   CREATE TABLE mode_ratings(user TEXT NOT NULL REFERENCES users(id), mode TEXT NOT NULL CHECK(mode IN ('bullet','blitz','rapid')), rating INTEGER NOT NULL DEFAULT 1200, played INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user,mode));
   CREATE TABLE migration_log(version INTEGER PRIMARY KEY, applied TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`,
  `ALTER TABLE games ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
   ALTER TABLE games ADD COLUMN mode TEXT;
   ALTER TABLE games ADD COLUMN rated INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE games ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE games ADD COLUMN white_ms INTEGER;
   ALTER TABLE games ADD COLUMN black_ms INTEGER;
   ALTER TABLE games ADD COLUMN turn_since INTEGER;
   ALTER TABLE games ADD COLUMN started_at INTEGER;
   ALTER TABLE games ADD COLUMN created_by TEXT REFERENCES users(id);
   ALTER TABLE games ADD COLUMN rematch_of TEXT REFERENCES games(id);
   ALTER TABLE games ADD COLUMN rematch_offer TEXT REFERENCES users(id);
   UPDATE games SET created_by=white;
   CREATE UNIQUE INDEX games_rematch ON games(rematch_of) WHERE rematch_of IS NOT NULL;
   CREATE INDEX games_players_status ON games(white,black,status);
   CREATE INDEX sessions_expiry ON sessions(expires);
   CREATE INDEX resets_expiry ON password_resets(expires);`,
  `ALTER TABLE games ADD COLUMN bot_level TEXT;
   ALTER TABLE games ADD COLUMN bot_error TEXT;
   CREATE TABLE analyses(game TEXT PRIMARY KEY REFERENCES games(id),status TEXT NOT NULL DEFAULT 'pending',progress INTEGER NOT NULL DEFAULT 0,result TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,finished TEXT);
   CREATE INDEX analyses_status ON analyses(status,created);`,
  `CREATE TABLE training_runs(id TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),item TEXT NOT NULL,path TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 0,assisted INTEGER NOT NULL DEFAULT 0,hints INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,mode TEXT NOT NULL DEFAULT 'guided',status TEXT NOT NULL DEFAULT 'active',created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
   CREATE UNIQUE INDEX training_active ON training_runs(user,item) WHERE status='active';
   CREATE INDEX training_progress ON training_runs(user,item,status);`,
  `CREATE INDEX games_active_clocks ON games(status) WHERE status='active' AND white_ms IS NOT NULL;
   CREATE INDEX games_active_bots ON games(status,kind) WHERE status='active' AND kind='bot' AND bot_error IS NULL;`,
];
export const SCHEMA_VERSION=migrations.length;

/** Every migration is atomic. Preserve a snapshot before changing a real database. */
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const existed = path !== ':memory:' && existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > migrations.length) { db.close(); throw Error('La base de datos requiere una versión más reciente de la aplicación.'); }
  // SQLite materializes a consistent standalone snapshot, including committed WAL.
  if (existed && version < migrations.length) {
    db.prepare('VACUUM INTO ?').run(`${path}.pre-v${migrations.length}-${Date.now()}.bak`);
  }
  for (let i = version; i < migrations.length; i++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version=${i + 1}`);
      if (i >= 1) db.prepare('INSERT INTO migration_log(version) VALUES(?)').run(i + 1);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  }
  db.exec('PRAGMA journal_mode=WAL');
  return db;
}
