'use strict';

const crypto = require('crypto');

const LATEST_DB_SCHEMA = 8;

function ensureAdminAuditTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      username TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status INTEGER NOT NULL,
      remoteAddress TEXT NOT NULL DEFAULT '',
      durationMs INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_ts ON admin_audit(ts DESC);
  `);
}

function ensureTuningHistoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tuning_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      component TEXT NOT NULL,
      event TEXT NOT NULL,
      settingsJson TEXT NOT NULL,
      diffJson TEXT NOT NULL,
      factsJson TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_tuning_history_ts ON tuning_history(ts DESC);
  `);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function hasColumn(db, table, name) {
  return columns(db, table).some(column => column.name === name);
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  if (!hasColumn(db, table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function migrateEmailNullable(db) {
  const email = columns(db, 'users').find(column => column.name === 'email');
  if (!email || email.notnull !== 1) return;
  const hasSubToken = hasColumn(db, 'users', 'sub_token');
  const hasBonusLinks = hasColumn(db, 'users', 'bonus_links');
  const hasVlessUuid = hasColumn(db, 'users', 'vless_uuid');
  const hasVlessUpload = hasColumn(db, 'users', 'vlessUploadBytes');
  const hasVlessDownload = hasColumn(db, 'users', 'vlessDownloadBytes');
  const hasVlessLastUpload = hasColumn(db, 'users', 'vlessLastUploadBytes');
  const hasVlessLastDownload = hasColumn(db, 'users', 'vlessLastDownloadBytes');
  db.exec(`
    ALTER TABLE users RENAME TO users_legacy;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      username TEXT NOT NULL UNIQUE,
      passHash TEXT NOT NULL,
      password TEXT NOT NULL DEFAULT '',
      expiry TEXT,
      protocols TEXT DEFAULT '["naive","mieru"]',
      quotaMB INTEGER DEFAULT 0,
      usedMB REAL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      lastSeen TEXT,
      sub_token TEXT,
      bonus_links TEXT,
      vless_uuid TEXT,
      vlessUploadBytes INTEGER DEFAULT 0,
      vlessDownloadBytes INTEGER DEFAULT 0,
      vlessLastUploadBytes INTEGER DEFAULT 0,
      vlessLastDownloadBytes INTEGER DEFAULT 0
    );
    INSERT INTO users
      (id,email,username,passHash,password,expiry,protocols,quotaMB,usedMB,
       createdAt,updatedAt,lastSeen,sub_token,bonus_links,vless_uuid,
       vlessUploadBytes,vlessDownloadBytes,vlessLastUploadBytes,vlessLastDownloadBytes)
    SELECT id, CASE WHEN email='' THEN NULL ELSE email END, username, passHash,
      password, expiry, protocols, quotaMB, usedMB, createdAt, updatedAt, lastSeen,
      ${hasSubToken ? 'sub_token' : 'NULL'}, ${hasBonusLinks ? 'bonus_links' : 'NULL'},
      ${hasVlessUuid ? 'vless_uuid' : 'NULL'},
      ${hasVlessUpload ? 'vlessUploadBytes' : '0'},
      ${hasVlessDownload ? 'vlessDownloadBytes' : '0'},
      ${hasVlessLastUpload ? 'vlessLastUploadBytes' : '0'},
      ${hasVlessLastDownload ? 'vlessLastDownloadBytes' : '0'}
    FROM users_legacy;
    DROP TABLE users_legacy;
  `);
}

const MIGRATIONS = [
  {
    version: 1,
    name: 'users plaintext password',
    up(db) { addColumn(db, 'users', "password TEXT NOT NULL DEFAULT ''"); },
  },
  {
    version: 2,
    name: 'optional email',
    up(db) { migrateEmailNullable(db); },
  },
  {
    version: 3,
    name: 'subscription token',
    up(db) { addColumn(db, 'users', 'sub_token TEXT'); },
  },
  {
    version: 4,
    name: 'bonus links',
    up(db) { addColumn(db, 'users', 'bonus_links TEXT'); },
  },
  {
    version: 5,
    name: 'per-user VLESS UUID',
    up(db) { addColumn(db, 'users', 'vless_uuid TEXT'); },
  },
  {
    version: 6,
    name: 'durable VLESS traffic counters',
    up(db) {
      addColumn(db, 'users', 'vlessUploadBytes INTEGER DEFAULT 0');
      addColumn(db, 'users', 'vlessDownloadBytes INTEGER DEFAULT 0');
      addColumn(db, 'users', 'vlessLastUploadBytes INTEGER DEFAULT 0');
      addColumn(db, 'users', 'vlessLastDownloadBytes INTEGER DEFAULT 0');
    },
  },
  {
    version: 7,
    name: 'administrator audit log',
    up(db) { ensureAdminAuditTable(db); },
  },
  {
    version: 8,
    name: 'VPN tuning history',
    up(db) { ensureTuningHistoryTable(db); },
  },
];

function runDatabaseMigrations(db, {
  randomBytes = crypto.randomBytes, randomUUID = crypto.randomUUID, logger = console,
} = {}) {
  let current = db.pragma('user_version', { simple: true }) || 0;
  const from = current;
  if (current > LATEST_DB_SCHEMA) {
    throw new Error(`database schema ${current} is newer than supported schema ${LATEST_DB_SCHEMA}`);
  }
  const applied = [];
  for (const migration of MIGRATIONS) {
    if (current >= migration.version) continue;
    db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    })();
    current = migration.version;
    applied.push({ version: migration.version, name: migration.name });
    logger.log(`[DB] migration ${migration.version} applied: ${migration.name}`);
  }

  // Invariants also repair databases whose historical version marker was
  // written incorrectly or whose migration was interrupted by old code.
  let missing = [];
  db.transaction(() => {
    addColumn(db, 'users', "password TEXT NOT NULL DEFAULT ''");
    migrateEmailNullable(db);
    addColumn(db, 'users', 'sub_token TEXT');
    addColumn(db, 'users', 'bonus_links TEXT');
    addColumn(db, 'users', 'vless_uuid TEXT');
    addColumn(db, 'users', 'vlessUploadBytes INTEGER DEFAULT 0');
    addColumn(db, 'users', 'vlessDownloadBytes INTEGER DEFAULT 0');
    addColumn(db, 'users', 'vlessLastUploadBytes INTEGER DEFAULT 0');
    addColumn(db, 'users', 'vlessLastDownloadBytes INTEGER DEFAULT 0');
    ensureAdminAuditTable(db);
    ensureTuningHistoryTable(db);
    db.prepare("UPDATE users SET email = NULL WHERE email = ''").run();
    missing = db.prepare("SELECT id FROM users WHERE sub_token IS NULL OR sub_token = ''").all();
    if (missing.length) {
      const update = db.prepare('UPDATE users SET sub_token = ? WHERE id = ?');
      for (const row of missing) update.run(randomBytes(16).toString('hex'), row.id);
    }
    const missingVless = db.prepare("SELECT id FROM users WHERE vless_uuid IS NULL OR vless_uuid = ''").all();
    if (missingVless.length) {
      const update = db.prepare('UPDATE users SET vless_uuid = ? WHERE id = ?');
      for (const row of missingVless) update.run(randomUUID(), row.id);
    }
    db.pragma(`user_version = ${LATEST_DB_SCHEMA}`);
  })();
  return { from, to: LATEST_DB_SCHEMA, applied, tokensBackfilled: missing.length };
}

module.exports = { LATEST_DB_SCHEMA, MIGRATIONS, runDatabaseMigrations };
