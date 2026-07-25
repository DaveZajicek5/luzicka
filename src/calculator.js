'use strict';

const { splitWeighted } = require('./utils');

const DEFAULT_COSTS = [
  ['rent', 'Nájemné', 'rent', 2500000, 'area_common', 10],
  ['building_services', 'Služby domu a voda', 'building_services', 140000, 'equal', 20],
  ['gas', 'Záloha na plyn', 'gas_advance', 220000, 'equal', 30],
  ['electricity', 'Záloha na elektřinu', 'electricity_advance', 250000, 'equal', 40],
  ['internet', 'Internet', 'internet', 49900, 'equal', 50],
  ['insurance', 'Pojištění domácnosti', 'insurance', 23000, 'equal', 60]
];

function migrateCalculator(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS household_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS monthly_cost_rules (
      code TEXT PRIMARY KEY,label TEXT NOT NULL,category_code TEXT NOT NULL REFERENCES categories(code),
      amount_halere INTEGER NOT NULL CHECK(amount_halere>=0),
      allocation_rule TEXT NOT NULL CHECK(allocation_rule IN ('equal','area_common','private_area','weights')),
      position INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS calculator_runs (
      period TEXT PRIMARY KEY,expense_ids_json TEXT NOT NULL,snapshot_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,
      length_m REAL NOT NULL CHECK(length_m>0),width_m REAL NOT NULL CHECK(width_m>0),
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS room_occupants (
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL REFERENCES people(id),
      PRIMARY KEY(room_id,person_id)
    );
    CREATE TABLE IF NOT EXISTS expense_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER NOT NULL REFERENCES expenses(id),
      original_name TEXT NOT NULL,stored_name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const columns = db.prepare('PRAGMA table_info(people)').all().map((column) => column.name);
  if (!columns.includes('private_area_m2')) {
    db.exec('ALTER TABLE people ADD COLUMN private_area_m2 REAL NOT NULL DEFAULT 0 CHECK(private_area_m2>=0)');
  }
  if (!columns.includes('payment_group')) {
    db.exec("ALTER TABLE people ADD COLUMN payment_group TEXT NOT NULL DEFAULT ''");
  }
}

function seedCalculator(db) {
  const setting = db.prepare('INSERT OR IGNORE INTO household_settings(key,value) VALUES (?,?)');
  setting.run('total_area_m2', '113');
  setting.run('payment_iban', '');
  setting.run('payment_due_day', '10');
  setting.run('waste_mixed_weekday', '');
  setting.run('waste_mixed_interval_weeks', '1');
  setting.run('waste_mixed_anchor_date', '');
  setting.run('waste_sorted_weekday', '');
  setting.run('waste_sorted_interval_weeks', '2');
  setting.run('waste_sorted_anchor_date', '');
  const cost = db.prepare(`INSERT OR IGNORE INTO monthly_cost_rules
    (code,label,category_code,amount_halere,allocation_rule,position) VALUES (?,?,?,?,?,?)`);
  for (const row of DEFAULT_COSTS) cost.run(...row);
  const defaults = [
    ['David Zajíček', 12.04], ['Anežka Tvrdá', 12.04],
    ['Max Hybner', 22.4], ['Barbora Miklíčková', 19.6]
  ];
  const update = db.prepare('UPDATE people SET private_area_m2=? WHERE name=? AND private_area_m2=0');
  for (const row of defaults) update.run(...row);
  db.prepare("UPDATE people SET payment_group='david-anezka' WHERE name IN ('David Zajíček','Anežka Tvrdá') AND payment_group=''").run();

  if (db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count === 0) {
    const room = db.prepare('INSERT INTO rooms(name,length_m,width_m,position) VALUES (?,?,?,?)');
    const occupant = db.prepare('INSERT INTO room_occupants(room_id,person_id) SELECT ?,id FROM people WHERE name=?');
    let result = room.run('Pokoj David + Anežka', 5.6, 4.3, 10);
    occupant.run(Number(result.lastInsertRowid), 'David Zajíček');
    occupant.run(Number(result.lastInsertRowid), 'Anežka Tvrdá');
    result = room.run('Pokoj Max', 5.6, 4, 20);
    occupant.run(Number(result.lastInsertRowid), 'Max Hybner');
    result = room.run('Pokoj Bára', 5.6, 3.5, 30);
    occupant.run(Number(result.lastInsertRowid), 'Barbora Miklíčková');
  }
}

function getSetting(db, key, fallback = '') {
  return db.prepare('SELECT value FROM household_settings WHERE key=?').get(key)?.value ?? fallback;
}

function calculatorData(db, period) {
  const people = db.prepare('SELECT * FROM people WHERE active=1 ORDER BY id').all();
  const rooms = db.prepare(`SELECT r.*,GROUP_CONCAT(ro.person_id) AS person_ids,
    GROUP_CONCAT(p.name, ', ') AS people_names FROM rooms r
    LEFT JOIN room_occupants ro ON ro.room_id=r.id LEFT JOIN people p ON p.id=ro.person_id
    GROUP BY r.id ORDER BY r.position,r.id`).all().map((room) => ({
      ...room, area_m2: room.length_m * room.width_m,
      personIds: room.person_ids ? room.person_ids.split(',').map(Number) : []
    }));
  const roomAreaByPerson = new Map();
  for (const room of rooms) {
    const share = room.personIds.length ? room.area_m2 / room.personIds.length : 0;
    for (const personId of room.personIds) roomAreaByPerson.set(personId, (roomAreaByPerson.get(personId) || 0) + share);
  }
  for (const person of people) {
    if (roomAreaByPerson.has(person.id)) person.private_area_m2 = roomAreaByPerson.get(person.id);
  }
  const costs = db.prepare('SELECT * FROM monthly_cost_rules WHERE active=1 ORDER BY position,code').all();
  const totalArea = Number(getSetting(db, 'total_area_m2', '0'));
  const privateArea = people.reduce((sum, person) => sum + Number(person.private_area_m2), 0);
  const commonArea = Math.max(0, totalArea - privateArea);
  const lines = costs.map((cost) => {
    let weighted;
    if (cost.allocation_rule === 'area_common') {
      const commonShare = people.length ? commonArea / people.length : 0;
      weighted = people.map((person) => ({ id: person.id, weight: Number(person.private_area_m2) + commonShare }));
    } else if (cost.allocation_rule === 'private_area') {
      weighted = people.map((person) => ({ id: person.id, weight: Number(person.private_area_m2) }));
    } else if (cost.allocation_rule === 'weights') {
      weighted = people.map((person) => ({ id: person.id, weight: Number(person.weight) }));
    } else {
      weighted = people.map((person) => ({ id: person.id, weight: 1 }));
    }
    return { ...cost, allocations: splitWeighted(cost.amount_halere, weighted) };
  });
  const totals = people.map((person) => ({
    ...person,
    amount_halere: lines.reduce((sum, line) =>
      sum + (line.allocations.find((item) => item.personId === person.id)?.amount || 0), 0)
  }));
  return {
    period, people, rooms, costs, lines, totals, totalArea, privateArea, commonArea,
    paymentIban: getSetting(db, 'payment_iban', ''),
    paymentDueDay: Number(getSetting(db, 'payment_due_day', '10')),
    wasteMixedWeekday: getSetting(db, 'waste_mixed_weekday', ''),
    wasteMixedIntervalWeeks: Number(getSetting(db, 'waste_mixed_interval_weeks', '1')),
    wasteMixedAnchorDate: getSetting(db, 'waste_mixed_anchor_date', ''),
    wasteSortedWeekday: getSetting(db, 'waste_sorted_weekday', ''),
    wasteSortedIntervalWeeks: Number(getSetting(db, 'waste_sorted_interval_weeks', '2')),
    wasteSortedAnchorDate: getSetting(db, 'waste_sorted_anchor_date', ''),
    generated: Boolean(db.prepare('SELECT 1 FROM calculator_runs WHERE period=?').get(period))
  };
}

function saveCalculatorSettings(db, audit, input) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const setting = db.prepare(`INSERT INTO household_settings(key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    setting.run('total_area_m2', String(input.totalArea));
    setting.run('payment_iban', input.paymentIban);
    setting.run('payment_due_day', String(input.paymentDueDay));
    const personUpdate = db.prepare('UPDATE people SET private_area_m2=? WHERE id=?');
    for (const person of input.people) personUpdate.run(person.privateArea, person.id);
    if (input.rooms) {
      const roomUpdate = db.prepare('UPDATE rooms SET name=?,length_m=?,width_m=? WHERE id=?');
      for (const room of input.rooms) roomUpdate.run(room.name, room.lengthM, room.widthM, room.id);
    }
    const costUpdate = db.prepare('UPDATE monthly_cost_rules SET amount_halere=?,allocation_rule=? WHERE code=?');
    for (const cost of input.costs) costUpdate.run(cost.amountHalere, cost.allocationRule, cost.code);
    for (const [key, value] of Object.entries(input.waste || {})) setting.run(key, String(value));
    audit(db, 'update', 'calculator_settings', null, input);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function generateCalculatorMonth(db, audit, period) {
  if (db.prepare('SELECT 1 FROM calculator_runs WHERE period=?').get(period)) {
    throw new Error('Tento měsíc už byl z kalkulačky vygenerován.');
  }
  const calculation = calculatorData(db, period);
  const expenseIds = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    const expense = db.prepare(`INSERT INTO expenses
      (occurred_on,period,category_code,description,amount_halere,paid_by_person_id)
      VALUES (?,?,?,?,?,?)`);
    const allocation = db.prepare(`INSERT INTO expense_allocations
      (expense_id,person_id,amount_halere,weight_snapshot) VALUES (?,?,?,1)`);
    const manager = calculation.people.find((person) => person.is_manager)?.id || null;
    for (const line of calculation.lines) {
      if (!line.amount_halere) continue;
      const result = expense.run(`${period}-01`, period, line.category_code, line.label, line.amount_halere, manager);
      const expenseId = Number(result.lastInsertRowid);
      expenseIds.push(expenseId);
      for (const item of line.allocations) allocation.run(expenseId, item.personId, item.amount);
    }
    db.prepare('INSERT INTO calculator_runs(period,expense_ids_json,snapshot_json) VALUES (?,?,?)')
      .run(period, JSON.stringify(expenseIds), JSON.stringify(calculation));
    audit(db, 'generate', 'calculator_month', null, { period, expenseIds, calculation });
    db.exec('COMMIT');
    return { expenseIds, calculation };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  migrateCalculator, seedCalculator, getSetting, calculatorData,
  saveCalculatorSettings, generateCalculatorMonth
};
