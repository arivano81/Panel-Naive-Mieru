'use strict';

const fs = require('fs');
const path = require('path');

function errorMessage(error) {
  if (!error) return 'unknown error';
  return String(error.error || error.message || error).trim();
}

function normalizeResult(result, fallbackMessage) {
  if (result === undefined || result === true) return { ok: true, error: '' };
  if (result === false) return { ok: false, error: fallbackMessage };
  if (result && typeof result === 'object') {
    return { ok: result.ok !== false, error: errorMessage(result.error || fallbackMessage) };
  }
  return { ok: false, error: fallbackMessage };
}

function safeRemove(file, io) {
  try { if (io.existsSync(file)) io.unlinkSync(file); } catch {}
}

/**
 * Atomically replace one file and restore the previous version if applying or
 * checking the new version fails. Hooks are synchronous by design because all
 * current service managers use execSync and must complete before success is
 * reported to the panel.
 */
function applyFileTransaction({
  targetPath,
  content,
  mode = 0o600,
  validate = () => ({ ok: true }),
  afterWrite = () => {},
  apply = () => ({ ok: true }),
  health = () => ({ ok: true }),
  rollbackApply = apply,
  io = fs,
}) {
  if (!targetPath) throw new Error('targetPath is required');

  const dir = path.dirname(targetPath);
  const tmp = targetPath + '.new';
  const backup = targetPath + '.last-good';
  const backupTmp = backup + '.new';
  const previous = targetPath + '.previous-good';
  const previousTmp = previous + '.new';
  const hadOriginal = io.existsSync(targetPath);

  io.mkdirSync(dir, { recursive: true });
  safeRemove(tmp, io);
  io.writeFileSync(tmp, content, { mode });
  // writeFile's creation mode is filtered through the process umask. The
  // panel intentionally runs with umask 077, while group-readable service
  // configs (for example root:xray 0640) must retain their declared mode.
  if (typeof io.chmodSync === 'function') io.chmodSync(tmp, mode);

  let check;
  try { check = normalizeResult(validate(tmp), 'validation failed'); }
  catch (error) { check = { ok: false, error: errorMessage(error) }; }
  if (!check.ok) {
    safeRemove(tmp, io);
    return { ok: false, phase: 'validate', error: check.error, rolledBack: false, backup: null };
  }

  try {
    safeRemove(backupTmp, io);
    safeRemove(previousTmp, io);
    if (hadOriginal) {
      io.copyFileSync(targetPath, backupTmp);
      // Keep two generations: the old last-good becomes previous-good only
      // after its replacement has been prepared successfully.
      if (io.existsSync(backup)) {
        io.copyFileSync(backup, previousTmp);
        io.renameSync(previousTmp, previous);
        if (typeof io.chmodSync === 'function') io.chmodSync(previous, mode);
      }
      io.renameSync(backupTmp, backup);
      if (typeof io.chmodSync === 'function') io.chmodSync(backup, mode);
    }
    io.renameSync(tmp, targetPath);
  } catch (error) {
    safeRemove(tmp, io);
    safeRemove(backupTmp, io);
    safeRemove(previousTmp, io);
    return { ok: false, phase: 'write', error: errorMessage(error), rolledBack: false,
             backup: hadOriginal ? backup : null, previous: io.existsSync(previous) ? previous : null };
  }

  let operation;
  try {
    afterWrite(targetPath);
    operation = normalizeResult(apply(targetPath), 'apply failed');
  }
  catch (error) { operation = { ok: false, error: errorMessage(error) }; }

  if (operation.ok) {
    try { operation = normalizeResult(health(targetPath), 'health check failed'); }
    catch (error) { operation = { ok: false, error: errorMessage(error) }; }
  }

  if (operation.ok) {
    return { ok: true, phase: 'complete', error: '', rolledBack: false,
             backup: hadOriginal ? backup : null, previous: io.existsSync(previous) ? previous : null };
  }

  let rollbackError = '';
  let rolledBack = false;
  try {
    if (hadOriginal && io.existsSync(backup)) io.copyFileSync(backup, targetPath);
    else safeRemove(targetPath, io);
    afterWrite(targetPath);
    if (hadOriginal) {
      const restored = normalizeResult(rollbackApply(targetPath), 'rollback apply failed');
      if (!restored.ok) throw new Error(restored.error);
    }
    rolledBack = true;
  } catch (error) {
    rollbackError = errorMessage(error);
  }

  return {
    ok: false,
    phase: rolledBack ? 'rolled-back' : 'rollback-failed',
    error: operation.error,
    rollbackError,
    rolledBack,
    backup: hadOriginal ? backup : null,
    previous: io.existsSync(previous) ? previous : null,
  };
}

module.exports = { applyFileTransaction, normalizeResult };
