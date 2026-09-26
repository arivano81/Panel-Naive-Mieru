#!/usr/bin/env node
'use strict';

const Database = require('../panel/node_modules/better-sqlite3');
const { restoreBackupState } = require('../panel/server/backupRestore');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { console.log('  ✓', message); pass++; }
  else { console.error('  ✗', message); fail++; }
}

console.log('Clean-install backup restore regression test');
const db = new Database(':memory:');
db.exec(`CREATE TABLE users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, username TEXT NOT NULL UNIQUE,
  passHash TEXT NOT NULL, password TEXT NOT NULL DEFAULT '', expiry TEXT,
  protocols TEXT, quotaMB INTEGER, usedMB REAL, createdAt TEXT, updatedAt TEXT,
  lastSeen TEXT, sub_token TEXT, bonus_links TEXT, vless_uuid TEXT,
  vlessUploadBytes INTEGER, vlessDownloadBytes INTEGER,
  vlessLastUploadBytes INTEGER, vlessLastDownloadBytes INTEGER
)`);
const upsert = db.prepare(`INSERT INTO users VALUES
  (@id,@email,@username,@passHash,@password,@expiry,@protocols,@quotaMB,@usedMB,
   @createdAt,@updatedAt,@lastSeen,@sub_token,@bonus_links,@vless_uuid,
   @vlessUploadBytes,@vlessDownloadBytes,@vlessLastUploadBytes,@vlessLastDownloadBytes)
  ON CONFLICT(id) DO UPDATE SET username=excluded.username, password=excluded.password,
    sub_token=excluded.sub_token, bonus_links=excluded.bonus_links,
    vless_uuid=excluded.vless_uuid`);

let config = { domain: 'fresh.example', serverIp: '192.0.2.10', version: '1.12.0',
  dbPath: '/local/db.sqlite', schemaVersion: 6 };
let persisted = JSON.stringify(config);
const base = {
  format: 'rixxx-panel-backup', schema: 3,
  config: { domain: 'old.example', serverIp: '198.51.100.4', version: '1.6.0' },
  users: [{
    id: 'u1', username: 'alice', passHash: 'hash', password: 'secret',
    protocols: '["naive","mieru"]', sub_token: 'stable-token',
    bonus_links: '[{"url":"vless://example","enabled":true}]',
    vless_uuid: '22222222-2222-4222-8222-222222222222',
    vlessUploadBytes: 1048576, vlessDownloadBytes: 2097152,
    vlessLastUploadBytes: 262144, vlessLastDownloadBytes: 524288,
  }],
};
const adapter = applyAllConfigs => ({
  backup: base, domainMode: 'backup', currentConfig: config,
  setConfig(value) { config = value; },
  saveConfig() { persisted = JSON.stringify(config); },
  upsertUser(user) { upsert.run(user); }, applyAllConfigs,
  transaction(fn) { return db.transaction(fn)(); }, now: 'now',
});

const restored = restoreBackupState(adapter(() => ({ servicesReloaded: true })));
const alice = db.prepare('SELECT * FROM users WHERE id=?').get('u1');
ok(restored.restoredUsers === 1, 'one user restored into an empty database');
ok(config.domain === 'old.example', 'backup network identity restored');
ok(config.dbPath === '/local/db.sqlite', 'local runtime path preserved');
ok(alice.password === 'secret', 'working client password preserved');
ok(alice.sub_token === 'stable-token', 'existing subscription URL token preserved');
ok(alice.bonus_links.includes('vless://example'), 'bonus links preserved');
ok(alice.vless_uuid === '22222222-2222-4222-8222-222222222222', 'VLESS UUID preserved');
ok(alice.vlessUploadBytes === 1048576 && alice.vlessLastDownloadBytes === 524288,
  'durable VLESS traffic state preserved');

const beforeConfig = persisted;
const failingBackup = JSON.parse(JSON.stringify(base));
failingBackup.config.domain = 'broken.example';
failingBackup.users.push({ id: 'u2', username: 'bob', passHash: 'hash2' });
let applyCalls = 0, failure;
try {
  restoreBackupState({ ...adapter(() => ({ servicesReloaded: ++applyCalls > 1 })), backup: failingBackup });
} catch (error) { failure = error; }
ok(!!failure, 'failed service activation rejects the restore');
ok(failure.recoverySucceeded === true, 'previous service state is reapplied');
ok(config.domain === 'old.example' && persisted === beforeConfig, 'previous config restored');
ok(!db.prepare('SELECT 1 FROM users WHERE id=?').get('u2'), 'database transaction rolled back');

db.close();
console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
