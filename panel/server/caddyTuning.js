'use strict';

const PROFILES = new Set(['conservative', 'balanced', 'throughput', 'custom']);

function integer(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return number;
}

function normalizeCaddyTuning(input = {}) {
  const profile = String(input.profile || 'balanced');
  if (!PROFILES.has(profile)) throw new Error('unknown NaiveProxy tuning profile');
  const value = {
    enabled: input.enabled === true,
    profile,
    dialTimeout: integer(input.dialTimeout ?? 30, 1, 120, 'dial timeout'),
    maxIdleConns: integer(input.maxIdleConns ?? 100, 1, 4096, 'maximum idle connections'),
    maxIdleConnsPerHost: integer(input.maxIdleConnsPerHost ?? 4, 1, 256, 'idle connections per host'),
  };
  if (value.maxIdleConnsPerHost > value.maxIdleConns)
    throw new Error('idle connections per host cannot exceed the global limit');
  return value;
}

function recommendCaddyTuning(facts = {}) {
  const constrained = Number(facts.memoryMB) < 768 || Number(facts.cpuLoadPercent) >= 80;
  const capable = !constrained && Number(facts.cpuCores) >= 2 && Number(facts.memoryMB) >= 1536;
  const settings = normalizeCaddyTuning({ enabled: true,
    profile: constrained ? 'conservative' : (capable ? 'throughput' : 'balanced'),
    dialTimeout: capable ? 20 : 30,
    maxIdleConns: constrained ? 50 : (capable ? 256 : 100),
    maxIdleConnsPerHost: constrained ? 2 : (capable ? 8 : 4),
  });
  return { settings, reasons: [
    constrained ? 'resource pressure: retain small upstream idle pools' :
      (capable ? 'sufficient CPU and memory: allow a larger reusable connection pool' : 'balanced upstream connection pool'),
    'dial timeout remains long enough for remote destinations on unstable networks',
    'TLS, domains, certificates, users and probe resistance are not changed',
  ] };
}

function renderCaddyTuning(input = {}) {
  if (input.enabled !== true) return '';
  const value = normalizeCaddyTuning(input);
  return `\n    dial_timeout ${value.dialTimeout}s` +
    `\n    max_idle_conns ${value.maxIdleConns}` +
    `\n    max_idle_conns_per_host ${value.maxIdleConnsPerHost}`;
}

module.exports = { normalizeCaddyTuning, recommendCaddyTuning, renderCaddyTuning };
