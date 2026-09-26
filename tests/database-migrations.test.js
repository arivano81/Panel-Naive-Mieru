#!/usr/bin/env node
'use strict';

const Database = require('../panel/node_modules/better-sqlite3');
const { LATEST_DB_SCHEMA, runDatabaseMigrations } = require('../panel/server/databaseMigrations');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Explicit SQLite migration regression test');
const db = new Database(':memory:');
db.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE,
    passHash TEXT NOT NULL, expiry TEXT, protocols TEXT, quotaMB INTEGER DEFAULT 0,
    usedMB REAL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, lastSeen TEXT
  );
  INSERT INTO users VALUES
    ('u1','','alice','hash',NULL,'["naive"]',0,0,'now','now',NULL);
`);

const result = runDatabaseMigrations(db, {
  randomBytes: () => Buffer.alloc(16, 0xab), logger: { log() {} },
});
const cols = db.prepare('PRAGMA table_info(users)').all();
const names = new Set(cols.map(column => column.name));
const user = db.prepare('SELECT * FROM users WHERE id = ?').get('u1');

ok(result.to === LATEST_DB_SCHEMA, 'all ordered migrations applied');
ok(db.pragma('user_version', { simple: true }) === LATEST_DB_SCHEMA, 'PRAGMA user_version recorded');
ok(names.has('password'), 'password column present');
ok(names.has('sub_token'), 'sub_token survives nullable-email table rebuild');
ok(names.has('bonus_links'), 'bonus_links survives nullable-email table rebuild');
ok(user.username === 'alice', 'existing user preserved');
ok(user.email === null, 'legacy empty email normalized to NULL');
ok(user.sub_token === 'ab'.repeat(16), 'missing subscription token backfilled');

const second = runDatabaseMigrations(db, { logger: { log() {} } });
ok(second.applied.length === 0, 'second run is idempotent');
ok(db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1, 'idempotent run preserves rows');

db.close();

const future = new Database(':memory:');
future.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
future.pragma(`user_version = ${LATEST_DB_SCHEMA + 1}`);
let futureRejected = false;
try { runDatabaseMigrations(future, { logger: { log() {} } }); }
catch (error) { futureRejected = /newer than supported/.test(error.message); }
ok(futureRejected, 'newer unknown database schema is refused, never downgraded');
future.close();
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
