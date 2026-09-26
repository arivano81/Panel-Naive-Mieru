'use strict';

const { runConfigMigrations } = require('./configMigrations');

const BACKUP_FORMAT = 'rixxx-panel-backup';
const BACKUP_SCHEMA = 3;
const NETWORK_KEYS = ['domain', 'serverIp', 'naivePort', 'mieruPortStart', 'mieruPortEnd', 'hy2Port'];
const PATH_KEYS = ['dbPath', 'caddyBin', 'caddyFile', 'caddyConfigDir', 'fakeSiteDir', 'mitaStateFile'];

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('No backup payload provided');
  if (backup.format !== BACKUP_FORMAT) throw new Error('Not a panel backup file (bad format tag)');
  if (!Number.isInteger(backup.schema) || backup.schema < 1 || backup.schema > BACKUP_SCHEMA)
    throw new Error(`Unsupported backup schema (${backup.schema}); supported up to ${BACKUP_SCHEMA}`);
  if (!backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config))
    throw new Error('Backup is missing its config section');
  if (!Array.isArray(backup.users)) throw new Error('Backup is missing its users list');
  for (const user of backup.users) {
    if (!user || typeof user !== 'object' || !user.id || !user.username || !user.passHash)
      throw new Error('Backup contains a malformed user record (need id, username, passHash)');
  }
}

function mergeBackupConfig(current, backupConfig, domainMode) {
  const incoming = JSON.parse(JSON.stringify(backupConfig));
  if (domainMode === 'current') {
    for (const key of NETWORK_KEYS) if (current[key] !== undefined) incoming[key] = current[key];
  }
  incoming.version = current.version || incoming.version;
  for (const key of PATH_KEYS) if (current[key] !== undefined) incoming[key] = current[key];
  return runConfigMigrations(incoming, { logger: { log() {} } }).config;
}

function normalizeBackupUser(user, now = new Date().toISOString()) {
  return {
    id: user.id, email: user.email || null, username: user.username,
    passHash: user.passHash, password: user.password || '',
    expiry: user.expiry || null, protocols: user.protocols || '["naive","mieru"]',
    quotaMB: user.quotaMB || 0, usedMB: user.usedMB || 0,
    createdAt: user.createdAt || now, updatedAt: now, lastSeen: user.lastSeen || null,
    sub_token: user.sub_token || null, bonus_links: user.bonus_links || null,
    vless_uuid: user.vless_uuid || null,
  };
}

function restoreBackupState({
  backup, domainMode, currentConfig, setConfig, saveConfig, upsertUser,
  applyAllConfigs, transaction = fn => fn(), now,
}) {
  validateBackup(backup);
  const previous = currentConfig;
  const incoming = mergeBackupConfig(currentConfig, backup.config, domainMode);
  let apply;
  try {
    transaction(() => {
      setConfig(incoming);
      saveConfig();
      for (const user of backup.users) upsertUser(normalizeBackupUser(user, now));
      apply = applyAllConfigs();
      if (!apply || !apply.servicesReloaded) {
        const details = [apply && apply.caddyError, apply && apply.mitaError, apply && apply.hy2Error]
          .filter(Boolean).join('; ');
        throw new Error('restored services failed health checks' + (details ? `: ${details}` : ''));
      }
    });
  } catch (error) {
    setConfig(previous);
    let configRestored = false;
    try { saveConfig(); configRestored = true; }
    catch (configError) { error.configRecoveryError = configError.message; }
    let recovery;
    try { recovery = configRestored ? applyAllConfigs() : { servicesReloaded: false }; }
    catch (recoveryError) {
      recovery = { servicesReloaded: false, error: recoveryError.message };
    }
    error.recoverySucceeded = !!(recovery && recovery.servicesReloaded);
    throw error;
  }
  return { config: incoming, restoredUsers: backup.users.length, apply };
}

module.exports = {
  BACKUP_FORMAT, BACKUP_SCHEMA, NETWORK_KEYS, PATH_KEYS,
  validateBackup, mergeBackupConfig, normalizeBackupUser, restoreBackupState,
};
