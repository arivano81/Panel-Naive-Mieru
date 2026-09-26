'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OPENFLUX_RELEASE } = require('./openfluxAdapter');

const DEFAULTS = Object.freeze({
  binary: '/usr/local/bin/openflux',
  lifecycleScript: path.join(__dirname, '../scripts/openflux_profile.sh'),
  installScript: path.join(__dirname, '../scripts/install_openflux.sh'),
  uninstallScript: path.join(__dirname, '../scripts/uninstall_openflux.sh'),
});
const PROFILE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

function safeFailure(error) {
  const raw = String(error && (error.stderr || error.stdout || error.message) || 'operation failed');
  return raw.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 500);
}

function createOpenFluxService(options = {}) {
  const paths = { ...DEFAULTS, ...(options.paths || {}) };
  const runFile = options.execFileSync || execFileSync;
  const fileExists = options.existsSync || fs.existsSync;
  const fileStat = options.lstatSync || fs.lstatSync;

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

  function runInstaller() {
    try {
      const output = String(runFile('bash', [paths.installScript], {
        timeout: 180000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }));
      const marker = output.match(/OPENFLUX_RESULT_JSON=(\{[^\r\n]+\})/);
      if (!marker) throw new Error('installer completed without a result marker');
      const result = JSON.parse(marker[1]);
      if (!installed()) throw new Error('installer completed without an OpenFlux binary');
      return result;
    } catch (error) {
      throw Object.assign(new Error(safeFailure(error)), { status: 500 });
    }
  }

  return Object.freeze({
    release: OPENFLUX_RELEASE,
    installed,
    list: () => installed() ? runLifecycle(['list']) : [],
    create: ({ id, port, host }) => runLifecycle(['create', String(id || ''), String(port || ''), String(host || '')]),
    action: (id, action) => runLifecycle([action, String(id || '')]),
    remove: id => runLifecycle(['remove', String(id || '')]),
    rotate: id => runLifecycle(['rotate', String(id || '')]),
    logs: (id, requestedLines) => {
      if (!installed()) throw Object.assign(new Error('OpenFlux is not installed'), { status: 409 });
      if (!PROFILE_ID_RE.test(String(id || '')))
        throw Object.assign(new Error('Invalid OpenFlux profile id'), { status: 400 });
      const lines = Math.max(1, Math.min(Number.parseInt(requestedLines, 10) || 100, 500));
      let output = '';
      try {
        output = String(runFile('journalctl', ['-u', `openflux-exit@${id}.service`, '-n', String(lines),
          '--no-pager', '--output=short-iso'], {
          timeout: 6000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }));
      } catch { return '(no logs available)'; }
      return output.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line =>
        /encryption.?key|password|secret|token/i.test(line) ? '[redacted sensitive line]' : line
      ).join('\n').slice(0, 65536);
    },
    bundle: id => {
      if (!installed()) throw Object.assign(new Error('OpenFlux is not installed'), { status: 409 });
      if (!PROFILE_ID_RE.test(String(id || '')))
        throw Object.assign(new Error('Invalid OpenFlux profile id'), { status: 400 });
      const dir = `/root/openflux-${id}-client`;
      const files = ['client.conf', 'openflux.key'];
      try {
        for (const name of files) {
          const stat = fileStat(path.join(dir, name));
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe bundle member');
        }
        return runFile('tar', ['-C', dir, '-czf', '-', ...files], {
          timeout: 10000, encoding: null, maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        throw Object.assign(new Error('OpenFlux client bundle is unavailable'), { status: 404 });
      }
    },
    install: runInstaller,
    update: runInstaller,
    uninstall: () => {
      try {
        const output = runFile('bash', [paths.uninstallScript, '--purge'], {
          timeout: 120000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        return JSON.parse(String(output));
      } catch (error) {
        throw Object.assign(new Error(safeFailure(error)), { status: 500 });
      }
    },
  });
}

module.exports = { createOpenFluxService, safeFailure };
