'use strict';

const STAT_RE = /^user>>>(.+)>>>traffic>>>(uplink|downlink)$/;

function parseXrayStats(raw) {
  let payload = raw;
  if (typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch { return {}; }
  }
  if (!payload || !Array.isArray(payload.stat)) return {};
  const out = {};
  for (const item of payload.stat) {
    const match = String(item && item.name || '').match(STAT_RE);
    if (!match) continue;
    const username = match[1];
    const bytes = Number(item.value);
    if (!username || !Number.isFinite(bytes) || bytes < 0) continue;
    if (!out[username]) out[username] = { uploadMB: 0, downloadMB: 0, usedMB: 0 };
    const key = match[2] === 'uplink' ? 'uploadMB' : 'downloadMB';
    out[username][key] += bytes / 1048576;
    out[username].usedMB += bytes / 1048576;
  }
  return out;
}

module.exports = { parseXrayStats };
