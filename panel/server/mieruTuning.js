'use strict';

const PROFILES = new Set(['conservative', 'balanced', 'throughput', 'custom']);
const MULTIPLEXING = new Set(['MULTIPLEXING_LOW', 'MULTIPLEXING_MIDDLE', 'MULTIPLEXING_HIGH']);
const TRANSPORTS = new Set(['TCP', 'TCP_UDP']);
const PATTERNS = new Set(['NOOP', 'RANDOM_PADDING', 'RANDOM_PADDING_AGGRESSIVE']);

function normalizeMieruTuning(input = {}) {
  const profile = String(input.profile || 'balanced');
  const multiplexing = String(input.multiplexing || 'MULTIPLEXING_MIDDLE');
  const transport = String(input.transport || 'TCP');
  const trafficPattern = String(input.trafficPattern || 'NOOP');
  const mtu = Number(input.mtu ?? 1400);
  if (!PROFILES.has(profile)) throw new Error('unknown Mieru tuning profile');
  if (!MULTIPLEXING.has(multiplexing)) throw new Error('unsupported Mieru multiplexing level');
  if (!TRANSPORTS.has(transport)) throw new Error('unsupported Mieru transport');
  if (!PATTERNS.has(trafficPattern)) throw new Error('unsupported Mieru traffic pattern');
  if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1400) throw new Error('Mieru MTU must be 1280..1400');
  return { enabled: input.enabled === true, profile, mtu, multiplexing, transport, trafficPattern };
}

function recommendMieruTuning(facts = {}) {
  const constrained = Number(facts.memoryMB) < 768 || Number(facts.cpuLoadPercent) >= 80;
  const capable = !constrained && Number(facts.cpuCores) >= 2 && Number(facts.memoryMB) >= 1536;
  const routeMtu = Number(facts.routeMtu) || 0;
  const mtu = routeMtu > 0 && routeMtu < 1400 ? Math.max(1280, routeMtu) : 1400;
  const settings = normalizeMieruTuning({ enabled: true,
    profile: constrained ? 'conservative' : (capable ? 'throughput' : 'balanced'),
    mtu,
    multiplexing: constrained ? 'MULTIPLEXING_LOW' : (capable ? 'MULTIPLEXING_HIGH' : 'MULTIPLEXING_MIDDLE'),
    transport: 'TCP',
    trafficPattern: 'NOOP',
  });
  return { settings, reasons: [
    routeMtu && routeMtu < 1400 ? `route MTU ${routeMtu}: capped Mieru MTU at ${mtu}` : 'route MTU permits the default 1400 payload',
    constrained ? 'resource pressure: low client multiplexing' :
      (capable ? 'sufficient CPU and memory: high client multiplexing' : 'balanced client multiplexing'),
    'TCP stays the safe default; enable UDP only after a network-specific test',
    'traffic shaping stays off until a measured filtering problem justifies its overhead',
  ] };
}

module.exports = { normalizeMieruTuning, recommendMieruTuning };
