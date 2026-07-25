'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { splitWeighted } = require('./utils');
const { migrateCalculator, seedCalculator, getSetting } = require('./calculator');

const CATEGORY_SEED = [
  ['rent', 'Nájemné', 'monthly'],
  ['building_services', 'Zálohy na služby domu', 'monthly'],
  ['internet', 'Internet', 'monthly'],
  ['electricity_advance', 'Záloha na elektřinu', 'monthly'],
  ['gas_advance', 'Záloha na plyn', 'monthly'],
  ['electricity_settlement', 'Vyúčtování elektřiny', 'settlement'],
  ['gas_settlement', 'Vyúčtování plynu', 'settlement'],
  ['building_settlement', 'Vyúčtování služeb domu', 'settlement'],
  ['shared_purchase', 'Společný nákup', 'adhoc'],
  ['other', 'Ostatní', 'adhoc']
];

function openDatabase(databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrate(db);
  seed(db);
  migrateCalculator(db);
  seedCalculator(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1 CHECK(weight > 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      is_manager INTEGER NOT NULL DEFAULT 0 CHECK(is_manager IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      code TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('monthly','settlement','adhoc'))
    );

    CREATE TABLE IF NOT EXISTS recurring_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_code TEXT NOT NULL REFERENCES categories(code),
      description TEXT NOT NULL,
      amount_halere INTEGER NOT NULL,
      due_day INTEGER NOT NULL DEFAULT 1 CHECK(due_day BETWEEN 1 AND 28),
      included_people_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_on TEXT NOT NULL,
      period TEXT NOT NULL,
      category_code TEXT NOT NULL REFERENCES categories(code),
      description TEXT NOT NULL,
      amount_halere INTEGER NOT NULL,
      paid_by_person_id INTEGER REFERENCES people(id),
      template_id INTEGER REFERENCES recurring_templates(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TEXT,
      void_reason TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_template_period
      ON expenses(template_id, period) WHERE template_id IS NOT NULL AND status = 'active';

    CREATE TABLE IF NOT EXISTS expense_allocations (
      expense_id INTEGER NOT NULL REFERENCES expenses(id),
      person_id INTEGER NOT NULL REFERENCES people(id),
      amount_halere INTEGER NOT NULL,
      weight_snapshot REAL NOT NULL,
      PRIMARY KEY(expense_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES people(id),
      period TEXT NOT NULL,
      paid_on TEXT NOT NULL,
      amount_halere INTEGER NOT NULL CHECK(amount_halere > 0),
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      voided_at TEXT,
      void_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS meter_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_type TEXT NOT NULL CHECK(meter_type IN ('electricity','gas')),
      read_on TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','void')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function seed(db) {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories(code,label,kind) VALUES (?,?,?)');
  for (const row of CATEGORY_SEED) insertCategory.run(...row);

  const count = db.prepare('SELECT COUNT(*) AS count FROM people').get().count;
  if (count === 0) {
    const insert = db.prepare('INSERT INTO people(name,weight,active,is_manager) VALUES (?,?,1,?)');
    insert.run('Hlavní nájemník', 1, 1);
    insert.run('Spolubydlící 2', 1, 0);
    insert.run('Spolubydlící 3', 1, 0);
    insert.run('Spolubydlící 4', 1, 0);
  }
}

function audit(db, action, entityType, entityId, details = {}) {
  db.prepare(`INSERT INTO audit_log(actor_role,action,entity_type,entity_id,details_json)
              VALUES ('admin',?,?,?,?)`)
    .run(action, entityType, entityId ?? null, JSON.stringify(details));
}

function listPeople(db, activeOnly = false) {
  return db.prepare(`SELECT * FROM people ${activeOnly ? 'WHERE active=1' : ''} ORDER BY active DESC, id`).all();
}

function listCategories(db) {
  return db.prepare("SELECT * FROM categories ORDER BY CASE kind WHEN 'monthly' THEN 1 WHEN 'settlement' THEN 2 ELSE 3 END, label").all();
}

function addExpense(db, input) {
  const selected = input.personIds.map(Number);
  const placeholders = selected.map(() => '?').join(',');
  const people = db.prepare(`SELECT id, weight FROM people WHERE id IN (${placeholders})`).all(...selected);
  if (people.length !== selected.length) throw new Error('Některý vybraný obyvatel neexistuje.');
  const allocations = splitWeighted(input.amountHalere, people);

  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`INSERT INTO expenses
      (occurred_on,period,category_code,description,amount_halere,paid_by_person_id,template_id)
      VALUES (?,?,?,?,?,?,?)`).run(
      input.occurredOn,
      input.period,
      input.categoryCode,
      input.description,
      input.amountHalere,
      input.paidByPersonId || null,
      input.templateId || null
    );
    const expenseId = Number(result.lastInsertRowid);
    const insertAllocation = db.prepare(`INSERT INTO expense_allocations
      (expense_id,person_id,amount_halere,weight_snapshot) VALUES (?,?,?,?)`);
    for (const allocation of allocations) {
      const person = people.find((p) => p.id === allocation.personId);
      insertAllocation.run(expenseId, allocation.personId, allocation.amount, person.weight);
    }
    audit(db, 'create', 'expense', expenseId, { ...input, allocations });
    db.exec('COMMIT');
    return expenseId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function generateRecurring(db, period) {
  const templates = db.prepare('SELECT * FROM recurring_templates WHERE active=1 ORDER BY id').all();
  let created = 0;
  let skipped = 0;
  for (const template of templates) {
    const exists = db.prepare("SELECT 1 FROM expenses WHERE template_id=? AND period=? AND status='active'").get(template.id, period);
    if (exists) { skipped += 1; continue; }
    const personIds = JSON.parse(template.included_people_json);
    const occurredOn = `${period}-${String(template.due_day).padStart(2, '0')}`;
    addExpense(db, {
      occurredOn,
      period,
      categoryCode: template.category_code,
      description: template.description,
      amountHalere: template.amount_halere,
      paidByPersonId: null,
      templateId: template.id,
      personIds
    });
    created += 1;
  }
  audit(db, 'generate', 'period', null, { period, created, skipped });
  return { created, skipped };
}

function monthData(db, period) {
  const people = db.prepare(`
    SELECT p.id,p.name,p.active,p.is_manager,
      COALESCE(SUM(CASE WHEN e.status='active' THEN a.amount_halere ELSE 0 END),0) AS due_halere,
      COALESCE((SELECT SUM(pay.amount_halere) FROM payments pay WHERE pay.person_id=p.id AND pay.period=? AND pay.status='active'),0) AS paid_halere
    FROM people p
    LEFT JOIN expense_allocations a ON a.person_id=p.id
    LEFT JOIN expenses e ON e.id=a.expense_id AND e.period=?
    GROUP BY p.id
    HAVING p.active=1 OR due_halere<>0 OR paid_halere<>0
    ORDER BY p.id
  `).all(period, period).map((p) => ({ ...p, balance_halere: p.due_halere - p.paid_halere }));

  const expenses = db.prepare(`
    SELECT e.*, c.label AS category_label, payer.name AS payer_name,
      GROUP_CONCAT(p.name || ': ' || printf('%.2f', a.amount_halere/100.0), ' | ') AS allocation_text
    FROM expenses e
    JOIN categories c ON c.code=e.category_code
    LEFT JOIN people payer ON payer.id=e.paid_by_person_id
    JOIN expense_allocations a ON a.expense_id=e.id
    JOIN people p ON p.id=a.person_id
    WHERE e.period=?
    GROUP BY e.id
    ORDER BY e.occurred_on,e.id
  `).all(period);

  const payments = db.prepare(`
    SELECT pay.*, p.name AS person_name FROM payments pay
    JOIN people p ON p.id=pay.person_id
    WHERE pay.period=? ORDER BY pay.paid_on,pay.id
  `).all(period);

  const categories = db.prepare(`
    SELECT c.label, SUM(e.amount_halere) AS amount_halere
    FROM expenses e JOIN categories c ON c.code=e.category_code
    WHERE e.period=? AND e.status='active'
    GROUP BY c.code ORDER BY ABS(amount_halere) DESC
  `).all(period);

  const meterReadings = db.prepare(`
    SELECT * FROM meter_readings
    WHERE status='active' AND substr(read_on,1,7)<=?
    ORDER BY meter_type, read_on DESC, id DESC
  `).all(period).filter((row, index, arr) => arr.findIndex((x) => x.meter_type === row.meter_type) === index);

  return {
    people,
    expenses,
    payments,
    categories,
    meterReadings,
    totalHalere: expenses.filter((e) => e.status === 'active').reduce((sum, e) => sum + e.amount_halere, 0),
    paymentEnabled: /^CZ[0-9A-Z]{22}$/.test(getSetting(db, 'payment_iban', '').replaceAll(' ', '').toUpperCase())
  };
}

module.exports = {
  openDatabase,
  audit,
  listPeople,
  listCategories,
  addExpense,
  generateRecurring,
  monthData
};
