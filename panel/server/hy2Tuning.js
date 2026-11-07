'use strict';

const PROFILES = new Set(['conservative', 'balanced', 'latency', 'throughput', 'custom']);
const CONGESTION = new Set(['bbr', 'reno']);
const BBR_PROFILES = new Set(['standard', 'conservative', 'aggressive']);
const RATE_RE = /^(?:0|[1-9]\d{0,5})\s*(?:kbps|mbps|gbps)$/i;
const BEGIN = '# BEGIN VertaFlux Hysteria2 tuning';
const END = '# END VertaFlux Hysteria2 tuning';

function integer(value, min, max, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return number;
}

function normalizeHy2Tuning(input = {}) {
  const profile = String(input.profile || 'balanced');
  const congestion = String(input.congestion || 'bbr').toLowerCase();
  const bbrProfile = String(input.bbrProfile || 'standard').toLowerCase();
  const up = String(input.bandwidthUp || '0 mbps').trim().toLowerCase();
  const down = String(input.bandwidthDown || '0 mbps').trim().toLowerCase();
  if (!PROFILES.has(profile)) throw new Error('unknown Hysteria2 tuning profile');
  if (!CONGESTION.has(congestion)) throw new Error('unsupported Hysteria2 congestion control');
  if (!BBR_PROFILES.has(bbrProfile)) throw new Error('unsupported Hysteria2 BBR profile');
  if (!RATE_RE.test(up) || !RATE_RE.test(down)) throw new Error('bandwidth must use kbps, mbps or gbps');
  return {
    enabled: input.enabled === true,
    profile, congestion, bbrProfile,
    maxIdleTimeout: integer(input.maxIdleTimeout ?? 30, 5, 300, 'QUIC idle timeout'),
    udpIdleTimeout: integer(input.udpIdleTimeout ?? 60, 10, 600, 'UDP idle timeout'),
    maxIncomingStreams: integer(input.maxIncomingStreams ?? 1024, 64, 8192, 'incoming streams'),
    disablePathMTUDiscovery: input.disablePathMTUDiscovery === true,
    ignoreClientBandwidth: input.ignoreClientBandwidth === true,
    bandwidthUp: up, bandwidthDown: down,
  };
}

function recommendHy2Tuning(facts = {}) {
  const constrained = Number(facts.memoryMB) < 768 || Number(facts.cpuLoadPercent) >= 80;
  const capable = !constrained && Number(facts.cpuCores) >= 2 && Number(facts.memoryMB) >= 1536;
  const lowMtu = Number(facts.routeMtu) > 0 && Number(facts.routeMtu) <= 1280;
  const settings = normalizeHy2Tuning({ enabled: true,
    profile: constrained ? 'conservative' : (capable ? 'throughput' : 'balanced'),
    congestion: 'bbr', bbrProfile: constrained ? 'conservative' : 'standard',
    maxIdleTimeout: 30, udpIdleTimeout: constrained ? 90 : 60,
    maxIncomingStreams: constrained ? 256 : (capable ? 2048 : 1024),
    disablePathMTUDiscovery: false, ignoreClientBandwidth: false,
    bandwidthUp: '0 mbps', bandwidthDown: '0 mbps',
  });
  return { settings, reasons: [
    constrained ? 'resource pressure: conservative stream limit' :
      (capable ? 'sufficient CPU and memory: throughput stream limit' : 'balanced server capacity'),
    lowMtu ? 'low route MTU detected; path MTU discovery remains enabled to adapt safely' :
      'path MTU discovery remains enabled; disable it only after a confirmed PMTU black hole',
    'bandwidth remains unlimited; measured link capacity is required before enabling Brutal limits',
  ] };
}

function renderHy2Tuning(input) {
  const value = normalizeHy2Tuning(input);
  if (!value.enabled) return '';
  const lines = [BEGIN, 'quic:', `  maxIdleTimeout: ${value.maxIdleTimeout}s`,
    `  maxIncomingStreams: ${value.maxIncomingStreams}`,
    `  disablePathMTUDiscovery: ${value.disablePathMTUDiscovery}`,
    'congestion:', `  type: ${value.congestion}`];
  if (value.congestion === 'bbr') lines.push(`  bbrProfile: ${value.bbrProfile}`);
  lines.push(`ignoreClientBandwidth: ${value.ignoreClientBandwidth}`,
    `udpIdleTimeout: ${value.udpIdleTimeout}s`);
  if (value.bandwidthUp !== '0 mbps' || value.bandwidthDown !== '0 mbps')
    lines.push('bandwidth:', `  up: ${value.bandwidthUp}`, `  down: ${value.bandwidthDown}`);
  lines.push(END);
  return `${lines.join('\n')}\n`;
}

function spliceHy2Tuning(configText, input) {
  const text = String(configText);
  const block = renderHy2Tuning(input);
  const managed = new RegExp(`^${BEGIN}[\\s\\S]*?^${END}\\r?\\n?`, 'm');
  if (managed.test(text)) return text.replace(managed, block);
  if (/^(?:quic|congestion|bandwidth|ignoreClientBandwidth|udpIdleTimeout):/m.test(text))
    throw new Error('existing unmanaged Hysteria2 tuning must be reviewed before panel management');
  return `${text.replace(/\s+$/, '')}\n\n${block}`;
}

module.exports = { normalizeHy2Tuning, recommendHy2Tuning, renderHy2Tuning, spliceHy2Tuning };
