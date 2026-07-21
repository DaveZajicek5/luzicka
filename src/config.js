'use strict';

const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value || value.startsWith('change-me')) {
    throw new Error(`Chybí bezpečná hodnota ${name}. Zkopírujte .env.example do .env a upravte ji.`);
  }
  return value;
}

function loadConfig(overrides = {}) {
  const config = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787),
    lanOnly: String(process.env.LAN_ONLY ?? 'true').toLowerCase() !== 'false',
    viewerPassword: required('VIEWER_PASSWORD'),
    adminPassword: required('ADMIN_PASSWORD'),
    sessionSecret: required('SESSION_SECRET'),
    databasePath: path.resolve(process.env.DATABASE_PATH || './data/luzicka.sqlite'),
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
