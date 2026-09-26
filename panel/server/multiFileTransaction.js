'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeResult } = require('./fileTransaction');

function message(error) {
  return String(error && (error.error || error.message) || error || 'unknown error').trim();
}

function remove(file, io) {
  try { if (io.existsSync(file)) io.unlinkSync(file); } catch {}
}

function applyMultiFileTransaction({ items, io = fs }) {
  if (!Array.isArray(items) || items.length < 2) throw new Error('at least two transaction items are required');
  const states = items.map((item, index) => {
    if (!item || !item.targetPath) throw new Error(`targetPath is required for item ${index}`);
    const target = item.targetPath;
    const hadOriginal = io.existsSync(target);
    return { item, target, tmp: `${target}.new`, backup: `${target}.last-good`, hadOriginal,
      original: hadOriginal ? io.readFileSync(target) : null, mode: item.mode == null ? 0o600 : item.mode };
  });

  try {
    for (const state of states) {
      io.mkdirSync(path.dirname(state.target), { recursive: true });
      remove(state.tmp, io);
      io.writeFileSync(state.tmp, state.item.content, { mode: state.mode });
      const checked = normalizeResult((state.item.validate || (() => true))(state.tmp), 'validation failed');
      if (!checked.ok) throw Object.assign(new Error(checked.error), { phase: 'validate' });
    }
  } catch (error) {
    for (const state of states) remove(state.tmp, io);
    return { ok: false, phase: error.phase || 'validate', error: message(error), rolledBack: false };
  }

  try {
    for (const state of states) {
      if (state.hadOriginal) {
        io.copyFileSync(state.target, state.backup);
        if (typeof io.chmodSync === 'function') io.chmodSync(state.backup, state.mode);
      }
      io.renameSync(state.tmp, state.target);
      if (typeof state.item.afterWrite === 'function') state.item.afterWrite(state.target);
    }
    for (const state of states) {
      const applied = normalizeResult((state.item.apply || (() => true))(state.target), 'apply failed');
      if (!applied.ok) throw new Error(applied.error);
      const healthy = normalizeResult((state.item.health || (() => true))(state.target), 'health check failed');
      if (!healthy.ok) throw new Error(healthy.error);
    }
    return { ok: true, phase: 'complete', error: '', rolledBack: false,
      backups: states.map(state => state.hadOriginal ? state.backup : null) };
  } catch (error) {
    let rollbackError = '';
    try {
      for (const state of states) {
        if (state.hadOriginal) io.writeFileSync(state.target, state.original, { mode: state.mode });
        else remove(state.target, io);
        if (typeof state.item.afterWrite === 'function') state.item.afterWrite(state.target);
      }
      for (const state of [...states].reverse()) {
        if (!state.hadOriginal) continue;
        const restored = normalizeResult((state.item.rollbackApply || state.item.apply || (() => true))(state.target),
          'rollback apply failed');
        if (!restored.ok) throw new Error(restored.error);
      }
    } catch (rollback) { rollbackError = message(rollback); }
    for (const state of states) remove(state.tmp, io);
    return { ok: false, phase: rollbackError ? 'rollback-failed' : 'rolled-back', error: message(error),
      rollbackError, rolledBack: !rollbackError,
      backups: states.map(state => state.hadOriginal ? state.backup : null) };
  }
}

module.exports = { applyMultiFileTransaction };
