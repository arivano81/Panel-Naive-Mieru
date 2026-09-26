'use strict';

const LATEST_CONFIG_SCHEMA = 6;

const CONFIG_MIGRATIONS = [
  { version: 1, name: 'probe mode', up(config) {
    if (config.probeMode == null) config.probeMode = 'bare';
  } },
  { version: 2, name: 'protected panel access', up(config) {
    if (config.panelHost == null) config.panelHost = '127.0.0.1';
    if (config.panelPort == null) config.panelPort = 3000;
    if (config.panelDomain == null) config.panelDomain = '';
    if (config.panelBasicAuthUser == null) config.panelBasicAuthUser = '';
    if (config.panelBasicAuthHash == null) config.panelBasicAuthHash = '';
    if (config.webBasePath == null) config.webBasePath = '';
    if (config.panelStubPage == null) config.panelStubPage = '/var/www/panel-stub/index.html';
    if (config.exposePanel == null) config.exposePanel = false;
  } },
  { version: 3, name: 'optional Hysteria2', up(config) {
    if (config.hy2Port == null) config.hy2Port = 443;
    if (!config.stack || typeof config.stack !== 'object' || Array.isArray(config.stack)) config.stack = {};
    if (config.stack.naive == null) config.stack.naive = true;
    if (config.stack.mieru == null) config.stack.mieru = true;
    if (config.stack.hy2 == null) config.stack.hy2 = false;
  } },
  { version: 4, name: 'subscription domain', up(config) {
    if (config.subBaseUrl == null) config.subBaseUrl = '';
  } },
  { version: 5, name: 'server label and federation', up(config) {
    if (config.serverFlag == null) config.serverFlag = '';
    if (config.federationToken == null) config.federationToken = '';
    if (!Array.isArray(config.federationNodes)) config.federationNodes = [];
  } },
  { version: 6, name: 'safe egress defaults', up(config) {
    if (config.warpEnabled == null) config.warpEnabled = false;
    if (config.warpPersist == null) config.warpPersist = false;
    if (config.cascadeEnabled == null) config.cascadeEnabled = false;
  } },
];

function runConfigMigrations(input, { logger = console } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('panel config must be a JSON object');
  const config = input;
  const from = Number.isInteger(config.schemaVersion) ? config.schemaVersion : 0;
  if (from > LATEST_CONFIG_SCHEMA)
    throw new Error(`config schema ${from} is newer than supported schema ${LATEST_CONFIG_SCHEMA}`);
  const applied = [];
  for (const migration of CONFIG_MIGRATIONS) {
    if (migration.version <= from) continue;
    migration.up(config);
    config.schemaVersion = migration.version;
    applied.push({ version: migration.version, name: migration.name });
    logger.log(`[CFG] migration ${migration.version} applied: ${migration.name}`);
  }
  return { config, from, to: LATEST_CONFIG_SCHEMA, applied, changed: applied.length > 0 };
}

module.exports = { LATEST_CONFIG_SCHEMA, CONFIG_MIGRATIONS, runConfigMigrations };
