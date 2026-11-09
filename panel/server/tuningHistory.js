'use strict';

function settingsDiff(before = {}, after = {}) {
  const diff = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (key === 'enabled') continue;
    const oldValue = before[key] === undefined ? null : before[key];
    const newValue = after[key] === undefined ? null : after[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue))
      diff.push({ key, before: oldValue, after: newValue });
  }
  return diff;
}

module.exports = { settingsDiff };
