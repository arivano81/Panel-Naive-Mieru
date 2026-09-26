'use strict';

const REDACTED = '[REDACTED]';

function redactLogText(value) {
  let text = String(value ?? '');
  text = text.replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, `$1${REDACTED}`);
  text = text.replace(/\b(vless:\/\/)[0-9a-f-]{36}(?=@)/gi, '$1[REDACTED_UUID]');
  text = text.replace(/\b(naive\+https?:\/\/[^\s:/@]+:)[^\s@]+@/gi, `$1${REDACTED}@`);
  text = text.replace(/(\/sub\/)[A-Za-z0-9_-]{16,}/gi, '$1[REDACTED_TOKEN]');
  text = text.replace(/([?&](?:password|passwd|token|secret|key|uuid|privateKey)=)[^&#\s]*/gi, `$1${REDACTED}`);
  text = text.replace(/((?:password|passwd|token|secret|private[_-]?key|probeSecret)\s*[=:]\s*)[^\s,;}]+/gi,
    `$1${REDACTED}`);
  text = text.replace(/("(?:password|passwd|token|secret|privateKey|probeSecret|vlessUuid)"\s*:\s*")[^"]*/gi,
    `$1${REDACTED}`);
  text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    '[REDACTED_UUID]');
  return text;
}

function redactLogArgument(value, seen = new WeakSet()) {
  if (typeof value === 'string') return redactLogText(value);
  if (value instanceof Error) return `${value.name}: ${redactLogText(value.message)}`;
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redactLogArgument(item, seen));
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = /password|passwd|token|secret|private.?key|uuid/i.test(key)
      ? REDACTED
      : redactLogArgument(item, seen);
  }
  return copy;
}

function installConsoleRedaction(target = console) {
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    if (typeof target[method] !== 'function') continue;
    const original = target[method].bind(target);
    target[method] = (...args) => original(...args.map(arg => redactLogArgument(arg)));
  }
  return target;
}

module.exports = { redactLogText, redactLogArgument, installConsoleRedaction };
