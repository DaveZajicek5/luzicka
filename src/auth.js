'use strict';

const crypto = require('node:crypto');
const { randomToken, timingSafeTextEqual } = require('./utils');

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSession(role, config) {
  const data = {
    role,
    csrf: randomToken(),
    exp: Date.now() + config.sessionHours * 60 * 60 * 1000
  };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${payload}.${sign(payload, config.sessionSecret)}`;
}

function readSession(req, config) {
  const token = parseCookies(req.headers.cookie).luzicka_session;
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !timingSafeTextEqual(sign(payload, config.sessionSecret), signature)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!['viewer', 'admin'].includes(data.role) || !data.csrf || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function sessionCookie(token, config) {
  const maxAge = Math.max(60, Math.floor(config.sessionHours * 60 * 60));
  const secure = config.secureCookies ? '; Secure' : '';
  return `luzicka_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearCookie(config = {}) {
  const secure = config.secureCookies ? '; Secure' : '';
  return `luzicka_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function roleForPassword(password, config) {
  if (timingSafeTextEqual(password, config.adminPassword)) return 'admin';
  if (timingSafeTextEqual(password, config.viewerPassword)) return 'viewer';
  return null;
}

function isPrivateAddress(input) {
  let ip = String(input || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '127.0.0.1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.')) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
  return false;
}

module.exports = {
  createSession,
  readSession,
  sessionCookie,
  clearCookie,
  roleForPassword,
  isPrivateAddress
};
