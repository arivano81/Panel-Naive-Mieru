'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OPENFLUX_RELEASE } = require('./openfluxAdapter');

const DEFAULTS = Object.freeze({
  binary: '/usr/local/bin/openflux',
  lifecycleScript: path.join(__dirname, '../scripts/openflux_profile.sh'),
  installScript: path.join(__dirname, '../scripts/install_openflux.sh'),
});

function safeFailure(error) {
  const raw = String(error && (error.stderr || error.stdout || error.message) || 'operation failed');
  return raw.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 500);
}

function createOpenFluxService(options = {}) {
  const paths = { ...DEFAULTS, ...(options.paths || {}) };
  const runFile = options.execFileSync || execFileSync;
  const fileExists = options.existsSync || fs.existsSync;

  function installed() {
    return fileExists(paths.binary) && fileExists(paths.lifecycleScript);
  }

  function runLifecycle(args, timeout = 30000) {
    if (!installed()) throw Object.assign(new Error('OpenFlux is not installed'), { status: 409 });
    try {
      const output = runFile('bash', [paths.lifecycleScript, ...args], {
        timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(String(output));
    } catch (error) {
      if (error.status === 409) throw error;
      throw Object.assign(new Error(safeFailure(error)), { status: 409 });
    }
  }

  return Object.freeze({
    release: OPENFLUX_RELEASE,
    installed,
    list: () => installed() ? runLifecycle(['list']) : [],
    create: ({ id, port, host }) => runLifecycle(['create', String(id || ''), String(port || ''), String(host || '')]),
    action: (id, action) => runLifecycle([action, String(id || '')]),
    remove: id => runLifecycle(['remove', String(id || '')]),
    install: () => {
      if (installed()) throw Object.assign(new Error('OpenFlux is already installed'), { status: 409 });
      try {
        runFile('bash', [paths.installScript], {
          timeout: 180000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (!installed()) throw new Error('installer completed without an OpenFlux binary');
        return { ok: true, installed: true, activated: false };
      } catch (error) {
        throw Object.assign(new Error(safeFailure(error)), { status: 500 });
      }
    },
  });
}

module.exports = { createOpenFluxService, safeFailure };
