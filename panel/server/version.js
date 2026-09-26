'use strict';

const fs = require('fs');

const RETRYABLE_READ_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

function readTextFileSync(file, readFileSync = fs.readFileSync, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return readFileSync(file, 'utf8');
    } catch (error) {
      lastError = error;
      if (!error || !RETRYABLE_READ_CODES.has(error.code) || attempt === retries) throw error;
    }
  }
  throw lastError;
}

function parseVersionFile(raw) {
  const text = String(raw || '');
  const match = text.match(/panel_version\s*=\s*([^\s#]+)/);
  return (match ? match[1] : text.split('\n')[0]).trim();
}

function readPanelVersion({
  versionFile,
  bundledVersionPaths = [],
  cfg = {},
  fallback,
  readFileSync = fs.readFileSync,
  retries = 2,
}) {
  try {
    const version = parseVersionFile(readTextFileSync(versionFile, readFileSync, retries));
    if (version) return version;
  } catch {}

  for (const file of bundledVersionPaths) {
    try {
      const version = readTextFileSync(file, readFileSync, retries).trim();
      if (version) return version;
    } catch {}
  }

  if (cfg && cfg.version) return String(cfg.version).trim();
  return fallback;
}

module.exports = { parseVersionFile, readPanelVersion, readTextFileSync };
