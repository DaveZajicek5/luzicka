'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const querystring = require('node:querystring');
const {
  openDatabase, audit, listPeople, listCategories, addExpense, generateRecurring, monthData
} = require('./db');
const {
  createSession, readSession, sessionCookie, clearCookie, roleForPassword, isPrivateAddress
} = require('./auth');
const {
  parseMoney, parseDecimal, currentPeriod, isPeriod, isDate, csvCell
} = require('./utils');
const { loginPage, servicesPage, dashboardPage, adminPage, auditPage, printPage } = require('./html');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'));

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > limit) reject(Object.assign(new Error('Požadavek je příliš velký.'), { status: 413 }));
    });
    req.on('end', () => resolve(querystring.parse(body)));
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'text/html; charset=utf-8', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function redirectWithCookie(res, location, cookie) {
  res.writeHead(303, { Location: location, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' });
  res.end();
}

function createServer(config) {
  const db = openDatabase(config.databasePath);
  const loginAttempts = new Map();

  function requireSession(req, res, admin = false) {
    const session = readSession(req, config);
    if (!session) { redirect(res, '/login'); return null; }
    if (admin && session.role !== 'admin') { send(res, 403, 'Administrátorské oprávnění je vyžadováno.', 'text/plain; charset=utf-8'); return null; }
    return session;
  }

  function verifyCsrf(session, body) {
    if (!body.csrf || body.csrf !== session.csrf) throw Object.assign(new Error('Neplatný bezpečnostní token. Obnovte stránku.'), { status: 403 });
  }

  function adminData() {
    const people = listPeople(db);
    const categories = listCategories(db);
    const templates = db.prepare(`
      SELECT t.*, c.label AS category_label,
        (SELECT GROUP_CONCAT(p.name, ', ') FROM people p WHERE p.id IN (SELECT value FROM json_each(t.included_people_json))) AS people_names
      FROM recurring_templates t JOIN categories c ON c.code=t.category_code ORDER BY t.active DESC,t.id
    `).all();
    const readings = db.prepare('SELECT * FROM meter_readings ORDER BY read_on DESC,id DESC LIMIT 200').all();
    return { people, categories, templates, readings };
  }

  return http.createServer(async (req, res) => {
    try {
      if (config.lanOnly && !isPrivateAddress(req.socket.remoteAddress)) {
        return send(res, 403, 'Přístup je povolen pouze z lokální sítě.', 'text/plain; charset=utf-8');
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/app.css') return send(res, 200, CSS, 'text/css; charset=utf-8', { 'Cache-Control': 'private, max-age=3600' });
      if (req.method === 'GET' && pathname === '/health') return send(res, 200, 'ok', 'text/plain; charset=utf-8');
      if (req.method === 'GET' && pathname === '/login') {
        if (readSession(req, config)) return redirect(res, '/');
        return send(res, 200, loginPage(config));
      }
      if (req.method === 'POST' && pathname === '/login') {
        const ip = req.socket.remoteAddress || 'unknown';
        const record = loginAttempts.get(ip) || { count: 0, since: Date.now() };
        if (Date.now() - record.since > 15 * 60 * 1000) { record.count = 0; record.since = Date.now(); }
        if (record.count >= 10) return send(res, 429, loginPage(config, 'Příliš mnoho pokusů. Zkuste to později.'));
        const body = await readBody(req);
        const role = roleForPassword(body.password || '', config);
        if (!role) {
          record.count += 1;
          loginAttempts.set(ip, record);
          return send(res, 401, loginPage(config, 'Nesprávné heslo.'));
        }
        loginAttempts.delete(ip);
        return redirectWithCookie(res, '/', sessionCookie(createSession(role, config), config));
      }

      if (req.method === 'POST' && pathname === '/logout') {
        const session = requireSession(req, res); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        return redirectWithCookie(res, '/login', clearCookie());
      }

      if (req.method === 'GET' && pathname === '/') {
        const session = requireSession(req, res); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : currentPeriod();
        return send(res, 200, dashboardPage({
          config, session, period, data: monthData(db, period),
          message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || ''
        }));
      }

      if (req.method === 'GET' && pathname === '/services') {
        const session = requireSession(req, res); if (!session) return;
        return send(res, 200, servicesPage({ config, session }));
      }

      if (req.method === 'GET' && pathname === '/admin') {
        const session = requireSession(req, res, true); if (!session) return;
        return send(res, 200, adminPage({ config, session, ...adminData(), message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || '' }));
      }

      if (req.method === 'POST' && pathname === '/expenses') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const personIds = Array.isArray(body.person_id) ? body.person_id : body.person_id ? [body.person_id] : [];
        if (!isDate(body.occurred_on) || !isPeriod(body.period)) throw new Error('Neplatné datum nebo měsíc.');
        const description = String(body.description || '').trim();
        if (!description) throw new Error('Popis položky nesmí být prázdný.');
        addExpense(db, {
          occurredOn: body.occurred_on,
          period: body.period,
          categoryCode: String(body.category_code),
          description,
          amountHalere: parseMoney(body.amount),
          paidByPersonId: body.paid_by_person_id ? Number(body.paid_by_person_id) : null,
          personIds
        });
        return redirect(res, `/?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Položka byla přidána.')}`);
      }

      const expenseVoid = pathname.match(/^\/expenses\/(\d+)\/void$/);
      if (req.method === 'POST' && expenseVoid) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(expenseVoid[1]);
        const reason = String(body.reason || '').trim();
        if (!reason) throw new Error('Uveďte důvod storna.');
        const result = db.prepare("UPDATE expenses SET status='void',voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=? AND status='active'").run(reason, id);
        if (!result.changes) throw new Error('Položka už je stornovaná nebo neexistuje.');
        audit(db, 'void', 'expense', id, { reason });
        return redirect(res, `/?period=${encodeURIComponent(body.period || currentPeriod())}&message=${encodeURIComponent('Položka byla stornována.')}`);
      }

      if (req.method === 'POST' && pathname === '/payments') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isDate(body.paid_on) || !isPeriod(body.period)) throw new Error('Neplatné datum nebo měsíc.');
        const amount = parseMoney(body.amount); if (amount <= 0) throw new Error('Platba musí být kladná.');
        const result = db.prepare('INSERT INTO payments(person_id,period,paid_on,amount_halere,note) VALUES (?,?,?,?,?)')
          .run(Number(body.person_id), body.period, body.paid_on, amount, String(body.note || '').trim());
        audit(db, 'create', 'payment', Number(result.lastInsertRowid), { ...body, amount_halere: amount });
        return redirect(res, `/?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Platba byla přidána.')}`);
      }

      const paymentVoid = pathname.match(/^\/payments\/(\d+)\/void$/);
      if (req.method === 'POST' && paymentVoid) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(paymentVoid[1]);
        const reason = String(body.reason || '').trim();
        if (!reason) throw new Error('Uveďte důvod storna.');
        const result = db.prepare("UPDATE payments SET status='void',voided_at=CURRENT_TIMESTAMP,void_reason=? WHERE id=? AND status='active'").run(reason, id);
        if (!result.changes) throw new Error('Platba už je stornovaná nebo neexistuje.');
        audit(db, 'void', 'payment', id, { reason });
        return redirect(res, `/?period=${encodeURIComponent(body.period || currentPeriod())}&message=${encodeURIComponent('Platba byla stornována.')}`);
      }

      if (req.method === 'POST' && pathname === '/meters') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isDate(body.read_on) || !['electricity', 'gas'].includes(body.meter_type)) throw new Error('Neplatný odečet.');
        const unit = String(body.unit || '').trim();
        if (!unit) throw new Error('Jednotka nesmí být prázdná.');
        const result = db.prepare('INSERT INTO meter_readings(meter_type,read_on,value,unit,note) VALUES (?,?,?,?,?)')
          .run(body.meter_type, body.read_on, parseDecimal(body.value), unit, String(body.note || '').trim());
        audit(db, 'create', 'meter_reading', Number(result.lastInsertRowid), body);
        return redirect(res, `/admin?message=${encodeURIComponent('Odečet byl uložen.')}`);
      }

      const meterVoid = pathname.match(/^\/meters\/(\d+)\/void$/);
      if (req.method === 'POST' && meterVoid) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(meterVoid[1]);
        const reason = String(body.reason || '').trim();
        if (!reason) throw new Error('Uveďte důvod storna.');
        const result = db.prepare("UPDATE meter_readings SET status='void' WHERE id=? AND status='active'").run(id);
        if (!result.changes) throw new Error('Odečet už je stornovaný nebo neexistuje.');
        audit(db, 'void', 'meter_reading', id, { reason });
        return redirect(res, `/admin?message=${encodeURIComponent('Odečet byl stornován.')}`);
      }

      if (req.method === 'POST' && pathname === '/templates') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const personIds = (Array.isArray(body.person_id) ? body.person_id : body.person_id ? [body.person_id] : []).map(Number);
        if (!personIds.length) throw new Error('Šablona musí obsahovat alespoň jednu osobu.');
        const amount = parseMoney(body.amount);
        const description = String(body.description || '').trim();
        const dueDay = Number(body.due_day);
        if (!description || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) throw new Error('Neplatná šablona.');
        const result = db.prepare('INSERT INTO recurring_templates(category_code,description,amount_halere,due_day,included_people_json) VALUES (?,?,?,?,?)')
          .run(body.category_code, description, amount, dueDay, JSON.stringify(personIds));
        audit(db, 'create', 'template', Number(result.lastInsertRowid), { ...body, personIds, amount_halere: amount });
        return redirect(res, `/admin?message=${encodeURIComponent('Pravidelná položka byla přidána.')}`);
      }

      const templateDeactivate = pathname.match(/^\/templates\/(\d+)\/deactivate$/);
      if (req.method === 'POST' && templateDeactivate) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(templateDeactivate[1]);
        db.prepare('UPDATE recurring_templates SET active=0 WHERE id=?').run(id);
        audit(db, 'deactivate', 'template', id, {});
        return redirect(res, `/admin?message=${encodeURIComponent('Šablona byla deaktivována.')}`);
      }

      if (req.method === 'POST' && pathname === '/generate') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isPeriod(body.period)) throw new Error('Neplatný měsíc.');
        const result = generateRecurring(db, body.period);
        return redirect(res, `/?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent(`Vytvořeno ${result.created}, přeskočeno ${result.skipped}.`)}`);
      }

      const personUpdate = pathname.match(/^\/people\/(\d+)$/);
      if (req.method === 'POST' && personUpdate) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(personUpdate[1]);
        const name = String(body.name || '').trim();
        const weight = Number(String(body.weight).replace(',', '.'));
        if (!name || !(weight > 0)) throw new Error('Jméno a váha musí být platné.');
        db.prepare('UPDATE people SET name=?,weight=?,active=? WHERE id=?').run(name, weight, body.active ? 1 : 0, id);
        audit(db, 'update', 'person', id, { name, weight, active: Boolean(body.active) });
        return redirect(res, `/admin?message=${encodeURIComponent('Osoba byla upravena.')}`);
      }

      if (req.method === 'GET' && pathname === '/audit') {
        const session = requireSession(req, res, true); if (!session) return;
        const entries = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
        return send(res, 200, auditPage({ config, session, entries }));
      }

      if (req.method === 'GET' && pathname === '/print') {
        const session = requireSession(req, res); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : currentPeriod();
        return send(res, 200, printPage({ config, period, data: monthData(db, period) }));
      }

      if (req.method === 'GET' && pathname === '/export/month.csv') {
        const session = requireSession(req, res); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : currentPeriod();
        const data = monthData(db, period);
        const lines = [];
        lines.push(['TYP','MĚSÍC','DATUM','OSOBA','KATEGORIE','POPIS','CELKEM_KČ','PODÍL_KČ','ZAPLACENO_KČ','ZŮSTATEK_KČ'].map(csvCell).join(';'));
        for (const p of data.people) lines.push(['SOUHRN',period,'',p.name,'','', '', (p.due_halere/100).toFixed(2).replace('.',','), (p.paid_halere/100).toFixed(2).replace('.',','), (p.balance_halere/100).toFixed(2).replace('.',',')].map(csvCell).join(';'));
        const detail = db.prepare("SELECT e.occurred_on,e.period,c.label AS category,e.description,e.amount_halere,p.name,a.amount_halere AS allocation_halere FROM expenses e JOIN categories c ON c.code=e.category_code JOIN expense_allocations a ON a.expense_id=e.id JOIN people p ON p.id=a.person_id WHERE e.period=? AND e.status='active' ORDER BY e.occurred_on,e.id,p.id").all(period);
        for (const row of detail) lines.push(['NÁKLAD',row.period,row.occurred_on,row.name,row.category,row.description,(row.amount_halere/100).toFixed(2).replace('.',','),(row.allocation_halere/100).toFixed(2).replace('.',','),'',''].map(csvCell).join(';'));
        for (const payment of data.payments.filter((x) => x.status === 'active')) lines.push(['PLATBA',period,payment.paid_on,payment.person_name,'',payment.note,'','',(payment.amount_halere/100).toFixed(2).replace('.',','),''].map(csvCell).join(';'));
        const csv = '\uFEFF' + lines.join('\r\n');
        return send(res, 200, csv, 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="luzicka-${period}.csv"` });
      }

      return send(res, 404, 'Nenalezeno.', 'text/plain; charset=utf-8');
    } catch (error) {
      console.error(error);
      const status = error.status || 400;
      const session = readSession(req, config);
      if (session?.role === 'admin') {
        return send(res, status, adminPage({ config, session, ...adminData(), error: error.message }));
      }
      return send(res, status, error.message || 'Došlo k chybě.', 'text/plain; charset=utf-8');
    }
  });
}

module.exports = { createServer };
