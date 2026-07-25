'use strict';

const crypto = require('node:crypto');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseMoney(value) {
  const normalized = String(value ?? '')
    .replace(/[\s\u00a0]/g, '')
    .replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Částka musí být číslo s nejvýše dvěma desetinnými místy.');
  }
  const halere = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(halere)) throw new Error('Částka je mimo podporovaný rozsah.');
  return halere;
}

function parseDecimal(value) {
  const normalized = String(value ?? '').replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) throw new Error('Hodnota měřidla musí být číslo.');
  return Number(normalized);
}

function formatMoney(halere) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format((Number(halere) || 0) / 100);
}

function formatMoneyInput(halere) {
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format((Number(halere) || 0) / 100);
}

function formatDecimal(value, digits = 3) {
  return new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: digits }).format(value);
}

function currentPeriod(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isPeriod(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value));
}

function isDate(value) {
  return /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(String(value));
}

function periodLabel(period) {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })
    .format(new Date(year, month - 1, 1));
}

function nextPeriod(period) {
  if (!isPeriod(period)) return period;
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function splitWeighted(totalHalere, people) {
  if (!people.length) throw new Error('Vyberte alespoň jednoho obyvatele.');
  const totalWeight = people.reduce((sum, p) => sum + Number(p.weight), 0);
  if (!(totalWeight > 0)) throw new Error('Součet podílů musí být větší než nula.');

  const raw = people.map((p) => ({
    personId: p.id,
    exact: totalHalere * Number(p.weight) / totalWeight
  }));
  const floorTowardZero = (n) => n < 0 ? Math.ceil(n) : Math.floor(n);
  const result = raw.map((item) => ({ personId: item.personId, amount: floorTowardZero(item.exact) }));
  let remainder = totalHalere - result.reduce((sum, x) => sum + x.amount, 0);

  const order = raw
    .map((item, index) => ({
      index,
      fraction: Math.abs(item.exact - floorTowardZero(item.exact))
    }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let cursor = 0;
  while (remainder !== 0) {
    const target = result[order[cursor % order.length].index];
    const step = remainder > 0 ? 1 : -1;
    target.amount += step;
    remainder -= step;
    cursor += 1;
  }
  return result;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function timingSafeTextEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[;"\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

module.exports = {
  escapeHtml,
  parseMoney,
  parseDecimal,
  formatMoney,
  formatMoneyInput,
  formatDecimal,
  currentPeriod,
  isPeriod,
  isDate,
  nextPeriod,
  periodLabel,
  splitWeighted,
  randomToken,
  timingSafeTextEqual,
  csvCell
};
