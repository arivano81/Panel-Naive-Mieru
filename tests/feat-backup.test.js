// ─────────────────────────────────────────────────────────────────────────────
// v1.6.0 — FEATURE: Backup (export) / Restore (import).
//
// Disaster recovery: download a single JSON with ALL users (incl. plaintext
// passwords + bcrypt hashes → regenerates the SAME working keys) and the full
// panel config, then restore it on a fresh server. If the new box keeps the
// same domain (DNS points to it), existing client keys keep working untouched.
//
// This test follows the suite's convention (no server boot, no DB): it does
//   (a) structural source checks on panel/server/index.js — endpoints present,
//       auth-gated, format tags, larger JSON body limit, non-destructive path;
//   (b) a standalone simulation of the two logic paths most likely to regress:
//       the export shape and the domain-mode merge on import.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs   = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };

const SERVER = path.join(__dirname, '..', 'panel', 'server', 'index.js');
const src = fs.readFileSync(SERVER, 'utf8');
const backupRestoreSrc = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'server', 'backupRestore.js'), 'utf8');
const backupCryptoSrc = fs.readFileSync(
  path.join(__dirname, '..', 'panel', 'server', 'backupCrypto.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'panel', 'public', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'panel', 'public', 'index.html'), 'utf8');

// ── (a) Structural checks ────────────────────────────────────────────────────
ok(!/app\.get\(\s*['"]\/api\/backup\/export['"]/.test(src),
   'plaintext backup export endpoint is removed');
ok(/app\.post\(\s*['"]\/api\/backup\/import['"]\s*,\s*requireAuth/.test(src),
   'POST /api/backup/import is registered and auth-gated');
ok(/app\.post\(\s*['"]\/api\/backup\/export\/encrypted['"]\s*,\s*requireAuth\s*,\s*backupSecretLimiter/.test(src),
   'encrypted export requires authentication and a dedicated rate limit');
ok((src.match(/app\.post\(\s*['"]\/api\/backup\/export\/encrypted['"]/g) || []).length === 1,
   'encrypted export route is registered exactly once');
ok(/bcrypt\.compareSync\(input\.adminPassword, cfg\.adminPassHash\)/.test(src),
   'encrypted export requires administrator password confirmation');
ok(/decryptBackup\(backup, req\.body && req\.body\.passphrase\)/.test(src),
   'encrypted import authenticates and decrypts before validation or mutation');
ok(/aes-256-gcm/.test(backupCryptoSrc) && /scryptSync/.test(backupCryptoSrc) && /setAAD/.test(backupCryptoSrc),
   'backup envelope uses scrypt and authenticated AES-256-GCM');
ok(!/async function backupExport\(\)[\s\S]{0,1200}prompt\(/.test(ui),
   'backup export never collects secrets through a visible browser prompt');
ok(['backup-admin-password', 'backup-passphrase', 'backup-passphrase-confirm', 'backup-unlock-passphrase']
  .every(id => new RegExp(`type="password" id="${id}"`).test(html)),
   'every backup secret is collected in a masked password field');
ok(/const BACKUP_FORMAT\s*=\s*'rixxx-panel-backup'/.test(backupRestoreSrc),
   'backup format tag is "rixxx-panel-backup"');
ok(/const BACKUP_SCHEMA\s*=\s*4/.test(backupRestoreSrc),
   'backup schema version is 4');

// Import must reject a wrong format tag / bad schema / missing sections BEFORE
// mutating anything.
const importBody = src.slice(src.indexOf("'/api/backup/import'"));
ok(/bad format tag/.test(backupRestoreSrc),   'import validates the format tag');
ok(/Unsupported backup schema/.test(backupRestoreSrc), 'import validates the schema version');
ok(/missing its config section/.test(backupRestoreSrc), 'import requires a config section');
ok(/missing its users list/.test(backupRestoreSrc),     'import requires a users list');
ok(/malformed user record/.test(backupRestoreSrc),       'import validates each user record');

// Import must go through the SAME rebuild path as normal add/delete.
ok(/applyAllConfigs\(\)/.test(backupRestoreSrc),
   'import rebuilds real configs via applyAllConfigs() (same path as add/delete)');
ok(/upsertUser\(/.test(backupRestoreSrc),
   'import restores users via upsertUser (idempotent, non-destructive)');

// The in-memory payload must carry the plaintext password (needed to regenerate
// keys), bcrypt passHash and full config before the complete object is encrypted.
const exportBody = src.slice(src.indexOf('function buildPortableBackup()'),
                             src.indexOf("'/api/backup/import'"));
ok(/password:\s*u\.password/.test(exportBody), 'encrypted payload includes client password (key regen)');
ok(/passHash:\s*u\.passHash/.test(exportBody), 'encrypted payload includes bcrypt passHash');
ok(/config:\s*cfg/.test(exportBody),           'encrypted payload includes the full config');
ok(/Content-Disposition/.test(exportBody),     'export sends a file download header');

// Body limit lifted so large backups import.
ok(/express\.json\(\{\s*limit:\s*'25mb'\s*\}\)/.test(src),
   'JSON body limit raised to 25mb for large backup imports');

// ── (b) Logic simulation: export shape ───────────────────────────────────────
function makeExport(cfg, users) {
  return {
    format: 'rixxx-panel-backup',
    schema: 3,
    version: '1.6.0',
    exportedAt: new Date().toISOString(),
    config: cfg,
    users: users.map(u => ({
      id: u.id, email: u.email || null, username: u.username,
      passHash: u.passHash, password: u.password || '',
      expiry: u.expiry || null, protocols: u.protocols || '["naive","mieru"]',
      quotaMB: u.quotaMB || 0, usedMB: u.usedMB || 0,
      createdAt: u.createdAt, updatedAt: u.updatedAt, lastSeen: u.lastSeen || null,
      sub_token: u.sub_token || null, bonus_links: u.bonus_links || null,
      vless_uuid: u.vless_uuid || null
    }))
  };
}

const cfgOld = {
  domain: 'old.example.com', serverIp: '10.0.0.1',
  naivePort: 443, mieruPortStart: 2012, mieruPortEnd: 2022,
  adminUser: 'admin', adminPassHash: '$2a$hash', language: 'ru'
};
const usersOld = [
  { id: 'u1', username: 'alice', passHash: '$2a$a', password: 'secretA',
    protocols: '["naive","mieru"]', sub_token: 'token-a',
    vless_uuid: '22222222-2222-4222-8222-222222222222',
    bonus_links: '[{"url":"vless://example","enabled":true}]', createdAt: 't0', updatedAt: 't0' },
  { id: 'u2', username: 'bob', passHash: '$2a$b', password: 'secretB',
    protocols: '["mieru"]', createdAt: 't0', updatedAt: 't0' }
];
const backup = makeExport(cfgOld, usersOld);
ok(backup.format === 'rixxx-panel-backup' && backup.schema === 3, 'export shape is tagged');
ok(backup.users.length === 2, 'export carries all users');
ok(backup.users[0].password === 'secretA', 'export preserves plaintext password');
ok(backup.config.domain === 'old.example.com', 'export carries the domain');
ok(backup.users[0].sub_token === 'token-a', 'export preserves subscription token');
ok(backup.users[0].bonus_links.includes('vless://example'), 'export preserves bonus links');
ok(backup.users[0].vless_uuid === usersOld[0].vless_uuid, 'export preserves VLESS UUID');

// round-trip: JSON serialise/parse must be lossless
const rt = JSON.parse(JSON.stringify(backup));
ok(rt.users[1].protocols === '["mieru"]', 'protocols survive JSON round-trip');

// ── (b) Logic simulation: domain-mode merge on import ────────────────────────
// Mirrors the server's merge: mode 'backup' keeps backup network identity;
// mode 'current' keeps the live server's network identity.
function importMerge(liveCfg, incomingCfg, domainMode) {
  const NETWORK_KEYS = ['domain', 'serverIp', 'naivePort', 'mieruPortStart', 'mieruPortEnd'];
  const PATH_KEYS = ['dbPath', 'caddyBin', 'caddyFile', 'caddyConfigDir', 'fakeSiteDir', 'mitaStateFile'];
  const incoming = { ...incomingCfg };
  if (domainMode === 'current') {
    for (const k of NETWORK_KEYS) if (liveCfg[k] !== undefined) incoming[k] = liveCfg[k];
  }
  incoming.version = liveCfg.version || incoming.version;
  for (const k of PATH_KEYS) if (liveCfg[k] !== undefined) incoming[k] = liveCfg[k];
  return incoming;
}

const liveCfg = {
  domain: 'new-server.example.com', serverIp: '20.0.0.9',
  naivePort: 8443, mieruPortStart: 3000, mieruPortEnd: 3010,
  version: '1.6.0', dbPath: '/var/lib/rixxx-panel/db.sqlite'
};

// mode 'backup' → the RESTORED domain is the backup's (clients unaffected)
const mBackup = importMerge(liveCfg, cfgOld, 'backup');
ok(mBackup.domain === 'old.example.com', "domainMode 'backup' keeps backup domain");
ok(mBackup.naivePort === 443,            "domainMode 'backup' keeps backup naivePort");
ok(mBackup.adminUser === 'admin',        "domainMode 'backup' still restores admin creds");
ok(mBackup.dbPath === '/var/lib/rixxx-panel/db.sqlite',
   "local path (dbPath) is always taken from the live server, never the backup");

// mode 'current' → keep THIS server's domain/ports (new DNS)
const mCurrent = importMerge(liveCfg, cfgOld, 'current');
ok(mCurrent.domain === 'new-server.example.com', "domainMode 'current' keeps live domain");
ok(mCurrent.naivePort === 8443,                  "domainMode 'current' keeps live naivePort");
ok(mCurrent.mieruPortStart === 3000,             "domainMode 'current' keeps live mieru ports");
ok(mCurrent.adminUser === 'admin',               "domainMode 'current' still restores admin creds");
ok(mCurrent.language === 'ru',                    "domainMode 'current' restores non-network settings");

// version is never downgraded by a backup
ok(mBackup.version === '1.6.0' && mCurrent.version === '1.6.0',
   'live version tag is preserved (backup never downgrades it)');

console.log(`\nResult: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
