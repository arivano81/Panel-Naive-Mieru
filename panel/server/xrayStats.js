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

function advanceCounter(total, previous, current) {
  const safeTotal = Number.isFinite(Number(total)) && Number(total) >= 0 ? Number(total) : 0;
  const safePrevious = Number.isFinite(Number(previous)) && Number(previous) >= 0 ? Number(previous) : 0;
  const safeCurrent = Number.isFinite(Number(current)) && Number(current) >= 0 ? Number(current) : 0;
  // Xray counters start again at zero after a service restart. A lower sample
  // therefore begins a new generation instead of subtracting old traffic.
  return safeTotal + (safeCurrent >= safePrevious ? safeCurrent - safePrevious : safeCurrent);
}

function accumulateXrayStats(db, live, users) {
  if (!db) return live || {};
  const byName = new Map((users || []).map(user => [user.username, user]));
  const update = db.prepare(`UPDATE users SET
    vlessUploadBytes=@uploadTotal, vlessDownloadBytes=@downloadTotal,
    vlessLastUploadBytes=@uploadCurrent, vlessLastDownloadBytes=@downloadCurrent
    WHERE id=@id`);
  const accumulated = {};
  for (const user of users || []) {
    const uploadTotal = Math.max(0, Number(user.vlessUploadBytes) || 0);
    const downloadTotal = Math.max(0, Number(user.vlessDownloadBytes) || 0);
    accumulated[user.username] = {
      uploadMB: uploadTotal / 1048576,
      downloadMB: downloadTotal / 1048576,
      usedMB: (uploadTotal + downloadTotal) / 1048576,
    };
  }
  db.transaction(() => {
    for (const [username, sample] of Object.entries(live || {})) {
      const user = byName.get(username);
      if (!user) continue;
      const uploadCurrent = Math.max(0, Math.round((Number(sample.uploadMB) || 0) * 1048576));
      const downloadCurrent = Math.max(0, Math.round((Number(sample.downloadMB) || 0) * 1048576));
      const uploadTotal = advanceCounter(user.vlessUploadBytes, user.vlessLastUploadBytes, uploadCurrent);
      const downloadTotal = advanceCounter(user.vlessDownloadBytes, user.vlessLastDownloadBytes, downloadCurrent);
      update.run({ id: user.id, uploadTotal, downloadTotal, uploadCurrent, downloadCurrent });
      accumulated[username] = {
        uploadMB: uploadTotal / 1048576,
        downloadMB: downloadTotal / 1048576,
        usedMB: (uploadTotal + downloadTotal) / 1048576,
      };
    }
  })();
  return accumulated;
}

module.exports = { parseXrayStats, advanceCounter, accumulateXrayStats };
