'use strict';

const crypto = require('crypto');
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input) {
  const clean = String(input || '').toUpperCase().replace(/[=\s-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('invalid base32 secret');
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret(randomBytes = crypto.randomBytes) {
  return encodeBase32(randomBytes(20));
}

function hotp(secret, counter) {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) |
    (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 1000000).padStart(6, '0');
}

function verifyTotp(secret, code, { now = Date.now(), window = 1, lastCounter = -1 } = {}) {
  const supplied = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(supplied)) return null;
  const current = Math.floor(now / 30000);
  try {
    for (let drift = -window; drift <= window; drift++) {
      const counter = current + drift;
      if (counter <= lastCounter) continue;
      const expected = hotp(secret, counter);
      if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return counter;
    }
  } catch { return null; }
  return null;
}

function otpauthUrl({ secret, account, issuer = 'VertaFlux' }) {
  const label = `${issuer}:${account}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { encodeBase32, decodeBase32, generateSecret, hotp, verifyTotp, otpauthUrl };
