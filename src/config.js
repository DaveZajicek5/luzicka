'use strict';

const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('change-me')) {
    throw new Error(`Chybí bezpečná hodnota ${name}. Nastavte ji v prostředí nebo v souboru .env.`);
  }
  return value;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() !== 'false';
}

function loadConfig(overrides = {}) {
  const cloud = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const defaultDatabasePath = volumePath ? path.join(volumePath, 'luzicka.sqlite') : './data/luzicka.sqlite';

  const config = {
    host: process.env.HOST || (cloud ? '0.0.0.0' : '127.0.0.1'),
    port: Number(process.env.PORT || 8787),
    lanOnly: booleanValue(process.env.LAN_ONLY, !cloud),
    secureCookies: booleanValue(process.env.SECURE_COOKIES, cloud),
    viewerPassword: required('VIEWER_PASSWORD'),
    adminPassword: required('ADMIN_PASSWORD'),
    sessionSecret: required('SESSION_SECRET'),
    databasePath: path.resolve(process.env.DATABASE_PATH || defaultDatabasePath),
    householdName: process.env.HOUSEHOLD_NAME || 'Lužická',
    sessionHours: Number(process.env.SESSION_HOURS || 12),
    ...overrides
  };

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT musí být celé číslo 1–65535.');
  }
  if (config.viewerPassword === config.adminPassword) {
    console.warn('Varování: VIEWER_PASSWORD a ADMIN_PASSWORD jsou stejné. Rozlišení rolí tím ztrácí smysl.');
  }
  return config;
}

module.exports = { loadConfig };
