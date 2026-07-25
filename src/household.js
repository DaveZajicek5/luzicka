'use strict';

const { getSetting } = require('./calculator');

const WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

function nextPickup(db, prefix, today = new Date()) {
  const weekday = Number(getSetting(db, `${prefix}_weekday`, ''));
  const anchorText = getSetting(db, `${prefix}_anchor_date`, '');
  const intervalWeeks = Math.max(1, Number(getSetting(db, `${prefix}_interval_weeks`, '1')) || 1);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^\d{4}-\d{2}-\d{2}$/.test(anchorText)) return null;
  const anchor = new Date(`${anchorText}T12:00:00`);
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  for (let i = 0; i < 370; i += 1) {
    const weeks = Math.floor((cursor - anchor) / (7 * 86400000));
    if (cursor.getDay() === weekday && weeks >= 0 && weeks % intervalWeeks === 0) return cursor;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}

function householdReminders(db, period, now = new Date()) {
  const reminders = [];
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (period === current) {
    for (const [type, label] of [['electricity', 'elektřiny'], ['gas', 'plynu']]) {
      const exists = db.prepare("SELECT 1 FROM meter_readings WHERE meter_type=? AND substr(read_on,1,7)=? AND status='active'").get(type, period);
      if (!exists) reminders.push(`Chybí odečet ${label} k 1. dni tohoto měsíce.`);
    }
  }
  for (const [prefix, label] of [['waste_mixed', 'směsného odpadu'], ['waste_sorted', 'tříděného odpadu']]) {
    const date = nextPickup(db, prefix, now);
    if (!date) continue;
    const days = Math.ceil((date - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000);
    if (days <= 2) reminders.push(`Svoz ${label}: ${days === 0 ? 'dnes' : days === 1 ? 'zítra' : 'za 2 dny'} (${WEEKDAYS[date.getDay()]}).`);
  }
  return reminders;
}

module.exports = { nextPickup, householdReminders, WEEKDAYS };
