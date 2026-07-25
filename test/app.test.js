'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/app');
const { splitWeighted } = require('../src/utils');
const { openDatabase, audit, monthData, transferCredit } = require('../src/db');
const { calculatorData, generateCalculatorMonth, reopenCalculatorMonth } = require('../src/calculator');

function config() {
  return {
    host: '127.0.0.1', port: 0, lanOnly: true,
    viewerPassword: 'viewer-pass', adminPassword: 'admin-pass',
    sessionSecret: '0123456789abcdef0123456789abcdef',
    databasePath: ':memory:', householdName: 'Test', sessionHours: 1
  };
}

async function start() {
  const server = createServer(config());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function login(base, password) {
  const response = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password })
  });
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function csrfFrom(html) {
  return html.match(/name="csrf" value="([^"]+)"/)?.[1];
}

test('vážené dělení zachová přesně haléře', () => {
  const result = splitWeighted(10000, [{ id: 1, weight: 1 }, { id: 2, weight: 1 }, { id: 3, weight: 1 }]);
  assert.equal(result.reduce((sum, x) => sum + x.amount, 0), 10000);
  assert.deepEqual(result.map((x) => x.amount), [3334, 3333, 3333]);
});

test('kalkulačka rozdělí známé náklady přesně a měsíc nevytvoří dvakrát', () => {
  const db = openDatabase(':memory:');
  const people = db.prepare('SELECT * FROM people ORDER BY id').all();
  const names = ['David Zajíček', 'Anežka Tvrdá', 'Barbora Miklíčková', 'Max Hybner'];
  const areas = [12.04, 12.04, 19.6, 22.4];
  people.forEach((person, index) => db.prepare('UPDATE people SET name=?,private_area_m2=? WHERE id=?').run(names[index], areas[index], person.id));
  db.prepare('DELETE FROM room_occupants').run();
  db.prepare('DELETE FROM rooms').run();
  const room = db.prepare('INSERT INTO rooms(name,length_m,width_m,position) VALUES (?,?,?,?)');
  const occupant = db.prepare('INSERT INTO room_occupants(room_id,person_id) VALUES (?,?)');
  let result = room.run('David + Anežka', 5.6, 4.3, 10);
  occupant.run(Number(result.lastInsertRowid), people[0].id);
  occupant.run(Number(result.lastInsertRowid), people[1].id);
  result = room.run('Bára', 5.6, 3.5, 20);
  occupant.run(Number(result.lastInsertRowid), people[2].id);
  result = room.run('Max', 5.6, 4, 30);
  occupant.run(Number(result.lastInsertRowid), people[3].id);

  const calculation = calculatorData(db, '2026-08');
  assert.equal(calculation.totalArea, 113);
  assert.ok(Math.abs(calculation.commonArea - 46.92) < 0.000001);
  assert.equal(calculation.lines.reduce((sum, line) => sum + line.amount_halere, 0), 3182900);
  assert.equal(calculation.totals.reduce((sum, person) => sum + person.amount_halere, 0), 3182900);
  assert.deepEqual(calculation.totals.map((person) => person.amount_halere), [610106, 610105, 950371, 1012318]);

  const generated = generateCalculatorMonth(db, audit, '2026-08');
  assert.equal(generated.expenseIds.length, 6);
  assert.equal(db.prepare("SELECT SUM(amount_halere) AS total FROM expenses WHERE period='2026-08'").get().total, 3182900);
  assert.throws(() => generateCalculatorMonth(db, audit, '2026-08'), /už byl/);
  const reopened = reopenCalculatorMonth(db, audit, '2026-08', 'Test opravy');
  assert.equal(reopened.voided, 6);
  assert.equal(calculatorData(db, '2026-08').generated, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM expenses WHERE period='2026-08' AND status='active'").get().count, 0);
  db.close();
});

test('přeplatek se převede jako sleva do dalšího měsíce a zdrojový měsíc vyrovná', () => {
  const db = openDatabase(':memory:');
  const person = db.prepare('SELECT * FROM people ORDER BY id LIMIT 1').get();
  db.prepare(`INSERT INTO expenses(occurred_on,period,category_code,description,amount_halere)
    VALUES ('2026-07-01','2026-07','rent','Nájem',100000)`).run();
  const expenseId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  db.prepare('INSERT INTO expense_allocations(expense_id,person_id,amount_halere,weight_snapshot) VALUES (?,?,100000,1)')
    .run(expenseId, person.id);
  db.prepare(`INSERT INTO payments(person_id,period,paid_on,amount_halere,note)
    VALUES (?,'2026-07','2026-07-10',125000,'Přeplatek')`).run(person.id);

  assert.equal(monthData(db, '2026-07').people.find((item) => item.id === person.id).balance_halere, -25000);
  transferCredit(db, '2026-07', '2026-08', person.id);
  assert.equal(monthData(db, '2026-07').people.find((item) => item.id === person.id).balance_halere, 0);
  assert.equal(monthData(db, '2026-08').people.find((item) => item.id === person.id).balance_halere, -25000);
  assert.throws(() => transferCredit(db, '2026-07', '2026-08', person.id), /už byl převeden/);
  db.close();
});

test('viewer neotevře administraci, admin přidá položku a export ji obsahuje', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const cssResponse = await fetch(`${base}/app.css?v=20260725-4`);
  const css = await cssResponse.text();
  assert.equal(cssResponse.status, 200);
  assert.match(css, /\.topbar a\s*\{[^}]*color:\s*#fff/);
  assert.match(css, /button,\s*\.button\s*\{[^}]*display:\s*inline-flex/);
  assert.match(css, /\.form-grid\s*\{[^}]*display:\s*grid/);

  const viewer = await login(base, 'viewer-pass');
  assert.equal(viewer.response.status, 303);
  const denied = await fetch(`${base}/admin`, { headers: { cookie: viewer.cookie }, redirect: 'manual' });
  assert.equal(denied.status, 403);
  const oneOff = await fetch(`${base}/one-off`, { headers: { cookie: viewer.cookie } });
  assert.equal(oneOff.status, 200);
  assert.match(await oneOff.text(), /Nový náklad/);

  const admin = await login(base, 'admin-pass');
  const adminResponse = await fetch(`${base}/admin?view=recurring`, { headers: { cookie: admin.cookie } });
  const html = await adminResponse.text();
  const csrf = csrfFrom(html);
  assert.ok(csrf);
  assert.match(html, /Pravidelné náklady/);

  const calculator = await fetch(`${base}/calculator?period=2026-07`, { headers: { cookie: admin.cookie } });
  const calculatorHtml = await calculator.text();
  assert.match(calculatorHtml, /Měsíční předpis/);
  assert.match(calculatorHtml, /Kontrola rozdělení/);
  assert.doesNotMatch(calculatorHtml, /Český IBAN/);
  const settings = await fetch(`${base}/calculator/settings?period=2026-07`, { headers: { cookie: admin.cookie } });
  const settingsHtml = await settings.text();
  assert.match(settingsHtml, /Nastavení domácnosti/);
  assert.match(settingsHtml, /Český IBAN/);

  const generate = await fetch(`${base}/calculator/generate`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['csrf', csrf], ['period', '2026-07']])
  });
  assert.equal(generate.status, 303);

  const add = await fetch(`${base}/expenses`, {
    method: 'POST', redirect: 'manual', headers: {
      cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams([
      ['csrf', csrf], ['occurred_on', '2026-07-01'], ['period', '2026-07'],
      ['category_code', 'internet'], ['description', 'Internet červenec'], ['amount', '800'],
      ['person_id', '1'], ['person_id', '2'], ['person_id', '3'], ['person_id', '4']
    ])
  });
  assert.equal(add.status, 303);

  const updatedCalculator = await fetch(`${base}/calculator?period=2026-07`, { headers: { cookie: admin.cookie } });
  assert.match(await updatedCalculator.text(), /Internet červenec/);

  const dashboard = await fetch(`${base}/?period=2026-07`, { headers: { cookie: viewer.cookie } });
  const dashboardHtml = await dashboard.text();
  assert.match(dashboardHtml, /Internet červenec/);
  assert.match(dashboardHtml, /800,00/);
  assert.match(dashboardHtml, /Potvrdit vyúčtování/);

  const confirm = await fetch(`${base}/statements/confirm`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: viewer.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams([['csrf', csrfFrom(dashboardHtml)], ['period', '2026-07'], ['person_id', '1']])
  });
  assert.equal(confirm.status, 303);

  const csv = await fetch(`${base}/export/month.csv?period=2026-07`, { headers: { cookie: viewer.cookie } });
  const csvText = await csv.text();
  assert.match(csvText, /Internet červenec/);
  assert.match(csvText, /200,00/);

  const auditResponse = await fetch(`${base}/audit`, { headers: { cookie: admin.cookie } });
  const auditHtml = await auditResponse.text();
  assert.match(auditHtml, /Přidán náklad/);
  assert.match(auditHtml, /<summary>Zobrazit detail<\/summary>/);
});
