'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const querystring = require('node:querystring');
const QRCode = require('qrcode');
const { formidable } = require('formidable');
const {
  openDatabase, audit, listPeople, listCategories, addExpense, voidExpense, generateRecurring, transferCredit, monthData
} = require('./db');
const {
  createSession, readSession, sessionCookie, clearCookie, roleForPassword, isPrivateAddress
} = require('./auth');
const {
  parseMoney, parseDecimal, currentPeriod, nextPeriod, isPeriod, isDate, csvCell, splitWeighted
} = require('./utils');
const {
  calculatorData, saveCalculatorSettings, generateCalculatorMonth, reopenCalculatorMonth, getSetting
} = require('./calculator');
const {
  loginPage, servicesPage, dashboardPage, oneOffPage, adminPage, auditPage, printPage,
  calculatorPage, calculatorSettingsPage
} = require('./html');

const CSS = Buffer.concat([
  fs.readFileSync(path.join(__dirname, '..', 'public', 'foundation.css')),
  fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css')),
  fs.readFileSync(path.join(__dirname, '..', 'public', 'calculator.css')),
  fs.readFileSync(path.join(__dirname, '..', 'public', 'adjustments.css')),
  fs.readFileSync(path.join(__dirname, '..', 'public', 'workflows.css')),
  fs.readFileSync(path.join(__dirname, '..', 'public', 'polish.css'))
]);

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

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      uploadDir: os.tmpdir(), maxFileSize: 10 * 1024 * 1024,
      maxFiles: 1, allowEmptyFiles: false, multiples: true
    });
    form.parse(req, (error, fields, files) => error ? reject(error) : resolve({
      body: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) && value.length === 1 ? value[0] : value])),
      file: (Array.isArray(files.attachment) ? files.attachment[0] : files.attachment) || null
    }));
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
    const costRules = db.prepare('SELECT * FROM monthly_cost_rules ORDER BY active DESC,position,code').all();
    return { people, categories, templates, readings, costRules };
  }

  return http.createServer(async (req, res) => {
    try {
      if (config.lanOnly && !isPrivateAddress(req.socket.remoteAddress)) {
        return send(res, 403, 'Přístup je povolen pouze z lokální sítě.', 'text/plain; charset=utf-8');
      }

      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/app.css') return send(res, 200, CSS, 'text/css; charset=utf-8', { 'Cache-Control': 'private, no-cache, max-age=0, must-revalidate' });
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

      if (req.method === 'POST' && pathname === '/statements/confirm') {
        const session = requireSession(req, res); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isPeriod(body.period)) throw new Error('Neplatný měsíc.');
        if (!db.prepare('SELECT 1 FROM calculator_runs WHERE period=?').get(body.period)) {
          throw new Error('Vyúčtování ještě není dokončené.');
        }
        const personIds = (Array.isArray(body.person_id) ? body.person_id : [body.person_id]).map(Number);
        const validIds = new Set(listPeople(db, true).map((person) => person.id));
        if (!personIds.length || personIds.some((personId) => !validIds.has(personId))) throw new Error('Neplatný obyvatel.');
        const confirm = db.prepare(`INSERT INTO statement_confirmations(period,person_id) VALUES (?,?)
          ON CONFLICT(period,person_id) DO UPDATE SET confirmed_at=CURRENT_TIMESTAMP`);
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const personId of personIds) confirm.run(body.period, personId);
          audit(db, 'confirm', 'statement', null, { period: body.period, personIds, role: session.role });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return redirect(res, `/?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Vyúčtování bylo potvrzeno.')}`);
      }

      if (req.method === 'POST' && pathname === '/credits/transfer') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isPeriod(body.source_period) || !isPeriod(body.target_period)) throw new Error('Neplatný měsíc převodu.');
        transferCredit(db, body.source_period, body.target_period, Number(body.person_id));
        return redirect(res, `/?period=${encodeURIComponent(body.target_period)}&message=${encodeURIComponent('Přeplatek byl převeden jako sleva do dalšího měsíce.')}`);
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

      if (req.method === 'GET' && pathname === '/one-off') {
        const session = requireSession(req, res); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : nextPeriod(currentPeriod());
        return send(res, 200, oneOffPage({
          config, session, people: listPeople(db), categories: listCategories(db), period,
          message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || ''
        }));
      }

      if (req.method === 'GET' && pathname === '/admin') {
        const session = requireSession(req, res, true); if (!session) return;
        return send(res, 200, adminPage({
          config, session, ...adminData(), view: url.searchParams.get('view') || 'home',
          message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || ''
        }));
      }

      if (req.method === 'POST' && pathname === '/cost-rules') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const label = String(body.label || '').trim();
        const amount = parseMoney(body.amount);
        const rule = String(body.allocation_rule || '');
        if (!label || amount < 0 || !['equal', 'area_common', 'private_area', 'weights'].includes(rule)) throw new Error('Neplatný pravidelný náklad.');
        const code = `custom_${Date.now()}`;
        const position = db.prepare('SELECT COALESCE(MAX(position),0)+10 AS position FROM monthly_cost_rules').get().position;
        db.prepare(`INSERT INTO monthly_cost_rules
          (code,label,category_code,amount_halere,allocation_rule,position) VALUES (?,?,?,?,?,?)`)
          .run(code, label, 'other', amount, rule, position);
        audit(db, 'create', 'cost_rule', null, { code, label, amount, rule });
        return redirect(res, `/admin?view=recurring&message=${encodeURIComponent('Pravidelný náklad byl přidán.')}`);
      }

      const costRuleUpdate = pathname.match(/^\/cost-rules\/([a-zA-Z0-9_-]+)$/);
      if (req.method === 'POST' && costRuleUpdate) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const label = String(body.label || '').trim();
        const amount = parseMoney(body.amount);
        const rule = String(body.allocation_rule || '');
        if (!label || amount < 0 || !['equal', 'area_common', 'private_area', 'weights'].includes(rule)) throw new Error('Neplatný pravidelný náklad.');
        db.prepare('UPDATE monthly_cost_rules SET label=?,amount_halere=?,allocation_rule=? WHERE code=?')
          .run(label, amount, rule, costRuleUpdate[1]);
        audit(db, 'update', 'cost_rule', null, { code: costRuleUpdate[1], label, amount, rule });
        return redirect(res, `/admin?view=recurring&message=${encodeURIComponent('Pravidelný náklad byl upraven.')}`);
      }

      const costRuleDeactivate = pathname.match(/^\/cost-rules\/([a-zA-Z0-9_-]+)\/deactivate$/);
      if (req.method === 'POST' && costRuleDeactivate) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        db.prepare('UPDATE monthly_cost_rules SET active=0 WHERE code=?').run(costRuleDeactivate[1]);
        audit(db, 'deactivate', 'cost_rule', null, { code: costRuleDeactivate[1] });
        return redirect(res, `/admin?view=recurring&message=${encodeURIComponent('Pravidelný náklad byl odebrán z budoucích měsíců.')}`);
      }

      const costRuleActivate = pathname.match(/^\/cost-rules\/([a-zA-Z0-9_-]+)\/activate$/);
      if (req.method === 'POST' && costRuleActivate) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        db.prepare('UPDATE monthly_cost_rules SET active=1 WHERE code=?').run(costRuleActivate[1]);
        audit(db, 'activate', 'cost_rule', null, { code: costRuleActivate[1] });
        return redirect(res, `/admin?view=recurring&message=${encodeURIComponent('Pravidelný náklad byl obnoven.')}`);
      }

      if (req.method === 'GET' && pathname === '/calculator') {
        const session = requireSession(req, res, true); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : currentPeriod();
        return send(res, 200, calculatorPage({
          config, session, period, data: calculatorData(db, period),
          message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || ''
        }));
      }

      if (req.method === 'GET' && pathname === '/calculator/settings') {
        const session = requireSession(req, res, true); if (!session) return;
        const period = isPeriod(url.searchParams.get('period')) ? url.searchParams.get('period') : currentPeriod();
        return send(res, 200, calculatorSettingsPage({
          config, session, period, data: calculatorData(db, period),
          message: url.searchParams.get('message') || '', error: url.searchParams.get('error') || ''
        }));
      }

      if (req.method === 'POST' && pathname === '/calculator/settings') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const totalArea = parseDecimal(body.total_area_m2);
        const paymentDueDay = Number(body.payment_due_day);
        const paymentIban = String(body.payment_iban || '').replace(/\s+/g, '').toUpperCase();
        if (!(totalArea > 0)) throw new Error('Celková plocha bytu musí být kladná.');
        if (!Number.isInteger(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 28) throw new Error('Den splatnosti musí být mezi 1 a 28.');
        if (paymentIban && !/^CZ\d{22}$/.test(paymentIban)) throw new Error('Český IBAN musí mít tvar CZ a 22 číslic.');
        const people = listPeople(db, true).map((person) => {
          return { id: person.id, privateArea: 0 };
        });
        const current = calculatorData(db, body.period || currentPeriod());
        const rooms = current.rooms.map((room) => {
          const lengthM = parseDecimal(body[`room_length_${room.id}`]);
          const widthM = parseDecimal(body[`room_width_${room.id}`]);
          const name = String(body[`room_name_${room.id}`] || '').trim();
          if (!name || !(lengthM > 0) || !(widthM > 0)) throw new Error('Název a rozměry pokoje musí být platné.');
          const share = lengthM * widthM / Math.max(1, room.personIds.length);
          for (const personId of room.personIds) {
            const person = people.find((item) => item.id === personId);
            if (person) person.privateArea += share;
          }
          return { id: room.id, name, lengthM, widthM };
        });
        if (rooms.reduce((sum, room) => sum + room.lengthM * room.widthM, 0) > totalArea) {
          throw new Error('Součet soukromých ploch je větší než plocha bytu.');
        }
        const allowedRules = ['equal', 'area_common', 'private_area', 'weights'];
        const costs = current.costs.map((cost) => {
          const allocationRule = body[`cost_rule_${cost.code}`] === undefined
            ? cost.allocation_rule
            : String(body[`cost_rule_${cost.code}`] || '');
          if (!allowedRules.includes(allocationRule)) throw new Error(`Neplatné pravidlo pro ${cost.label}.`);
          const amountHalere = body[`cost_amount_${cost.code}`] === undefined
            ? cost.amount_halere
            : parseMoney(body[`cost_amount_${cost.code}`]);
          if (amountHalere < 0) throw new Error(`Částka ${cost.label} nesmí být záporná.`);
          return { code: cost.code, amountHalere, allocationRule };
        });
        const waste = {};
        for (const prefix of ['waste_mixed', 'waste_sorted']) {
          const weekday = String(body[`${prefix}_weekday`] || '');
          const interval = Number(body[`${prefix}_interval_weeks`]);
          const anchor = String(body[`${prefix}_anchor_date`] || '');
          if (weekday && !/^[0-6]$/.test(weekday)) throw new Error('Neplatný den svozu.');
          if (!Number.isInteger(interval) || interval < 1 || interval > 8) throw new Error('Interval svozu musí být 1–8 týdnů.');
          if (anchor && !isDate(anchor)) throw new Error('Neplatné počáteční datum svozu.');
          waste[`${prefix}_weekday`] = weekday;
          waste[`${prefix}_interval_weeks`] = interval;
          waste[`${prefix}_anchor_date`] = anchor;
        }
        saveCalculatorSettings(db, audit, { totalArea, paymentIban, paymentDueDay, people, rooms, costs, waste });
        const period = isPeriod(body.period) ? body.period : currentPeriod();
        return redirect(res, `/calculator?period=${encodeURIComponent(period)}&message=${encodeURIComponent('Nastavení a náhled byly přepočítány.')}`);
      }

      if (req.method === 'POST' && pathname === '/calculator/generate') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isPeriod(body.period)) throw new Error('Neplatný měsíc.');
        generateCalculatorMonth(db, audit, body.period);
        return redirect(res, `/?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Měsíční předpis byl vytvořen a připsán nájemníkům.')}`);
      }

      if (req.method === 'POST' && pathname === '/calculator/reopen') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isPeriod(body.period)) throw new Error('Neplatný měsíc.');
        const reason = String(body.reason || 'Vráceno k opravě předpisu').trim();
        reopenCalculatorMonth(db, audit, body.period, reason);
        return redirect(res, `/calculator?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Předpis byl stornován a měsíc je znovu připravený k úpravě.')}`);
      }

      if (req.method === 'GET' && pathname === '/payment-qr.svg') {
        const session = requireSession(req, res); if (!session) return;
        const period = url.searchParams.get('period');
        const personId = Number(url.searchParams.get('person'));
        if (!isPeriod(period) || !Number.isInteger(personId)) throw new Error('Neplatné údaje platby.');
        const month = monthData(db, period);
        const person = month.people.find((item) => item.id === personId);
        if (!person || person.payment_group_balance_halere <= 0) throw new Error('Pro tuto osobu není co platit.');
        const iban = getSetting(db, 'payment_iban', '').replace(/\s+/g, '').toUpperCase();
        if (!/^CZ\d{22}$/.test(iban)) throw new Error('Správce zatím nenastavil účet pro QR platby.');
        const variableSymbol = `${period.replace('-', '')}${String(personId).padStart(2, '0')}`.slice(0, 10);
        const amount = person.payment_group_balance_halere || person.balance_halere;
        const message = `Luzicka ${period} ${person.payment_group_names || person.name}`.replace(/[*:]/g, ' ').slice(0, 60);
        const spd = `SPD*1.0*ACC:${iban}*AM:${(amount / 100).toFixed(2)}*CC:CZK*X-VS:${variableSymbol}*MSG:${message}`;
        const svg = await QRCode.toString(spd, { type: 'svg', margin: 1, width: 360, errorCorrectionLevel: 'M' });
        return send(res, 200, svg, 'image/svg+xml; charset=utf-8');
      }

      if (req.method === 'POST' && pathname === '/expenses') {
        const session = requireSession(req, res); if (!session) return;
        const multipart = String(req.headers['content-type'] || '').startsWith('multipart/form-data');
        const parsed = multipart ? await readMultipart(req) : { body: await readBody(req), file: null };
        const { body } = parsed; verifyCsrf(session, body);
        const personIds = Array.isArray(body.person_id) ? body.person_id : body.person_id ? [body.person_id] : [];
        if (!isDate(body.occurred_on) || !isPeriod(body.period)) throw new Error('Neplatné datum nebo měsíc.');
        const description = String(body.description || '').trim();
        if (!description) throw new Error('Popis položky nesmí být prázdný.');
        const allowedAttachments = new Map([
          ['application/pdf', '.pdf'], ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/heic', '.heic']
        ]);
        if (parsed.file?.size && !allowedAttachments.has(parsed.file.mimetype)) {
          fs.rmSync(parsed.file.filepath, { force: true });
          throw new Error('Příloha musí být PDF, JPG, PNG nebo HEIC.');
        }
        let amountHalere = parseMoney(body.amount);
        if (body.entry_type === 'credit') amountHalere = -Math.abs(amountHalere);
        else if (body.entry_type === 'charge') amountHalere = Math.abs(amountHalere);
        const expenseId = addExpense(db, {
          occurredOn: body.occurred_on,
          period: body.period,
          categoryCode: String(body.category_code),
          description,
          amountHalere,
          paidByPersonId: body.paid_by_person_id ? Number(body.paid_by_person_id) : null,
          personIds
        });
        if (parsed.file?.size) {
          const extension = allowedAttachments.get(parsed.file.mimetype);
          const attachmentDir = path.join(path.dirname(config.databasePath), 'attachments');
          fs.mkdirSync(attachmentDir, { recursive: true });
          const storedName = `${crypto.randomUUID()}${extension}`;
          fs.renameSync(parsed.file.filepath, path.join(attachmentDir, storedName));
          db.prepare(`INSERT INTO expense_attachments(expense_id,original_name,stored_name,mime_type,size_bytes)
            VALUES (?,?,?,?,?)`).run(expenseId, String(parsed.file.originalFilename || 'příloha'), storedName, parsed.file.mimetype, parsed.file.size);
          audit(db, 'create', 'expense_attachment', null, { expenseId, originalName: parsed.file.originalFilename, size: parsed.file.size });
        }
        return redirect(res, `/one-off?period=${encodeURIComponent(body.period)}&message=${encodeURIComponent('Náklad byl zařazen do vyúčtování.')}`);
      }

      const attachmentDownload = pathname.match(/^\/attachments\/(\d+)$/);
      if (req.method === 'GET' && attachmentDownload) {
        const session = requireSession(req, res); if (!session) return;
        const attachment = db.prepare('SELECT * FROM expense_attachments WHERE id=?').get(Number(attachmentDownload[1]));
        if (!attachment) return send(res, 404, 'Příloha neexistuje.', 'text/plain; charset=utf-8');
        const filePath = path.join(path.dirname(config.databasePath), 'attachments', attachment.stored_name);
        if (!fs.existsSync(filePath)) return send(res, 404, 'Soubor přílohy chybí.', 'text/plain; charset=utf-8');
        return send(res, 200, fs.readFileSync(filePath), attachment.mime_type, {
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.original_name)}`
        });
      }

      const expenseAttachment = pathname.match(/^\/expenses\/(\d+)\/attachment$/);
      if (req.method === 'GET' && expenseAttachment) {
        const session = requireSession(req, res); if (!session) return;
        const attachment = db.prepare('SELECT id FROM expense_attachments WHERE expense_id=? ORDER BY id DESC LIMIT 1').get(Number(expenseAttachment[1]));
        if (!attachment) return send(res, 404, 'Příloha neexistuje.', 'text/plain; charset=utf-8');
        return redirect(res, `/attachments/${attachment.id}`);
      }

      const expenseVoid = pathname.match(/^\/expenses\/(\d+)\/void$/);
      if (req.method === 'POST' && expenseVoid) {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        const id = Number(expenseVoid[1]);
        const reason = String(body.reason || '').trim();
        if (!reason) throw new Error('Uveďte důvod storna.');
        const result = voidExpense(db, id, reason);
        return redirect(res, `/?period=${encodeURIComponent(result.period)}&message=${encodeURIComponent('Položka a související zápočet platby byly stornovány.')}`);
      }

      if (req.method === 'POST' && pathname === '/payments') {
        const session = requireSession(req, res, true); if (!session) return;
        const body = await readBody(req); verifyCsrf(session, body);
        if (!isDate(body.paid_on) || !isPeriod(body.period)) throw new Error('Neplatné datum nebo měsíc.');
        const amount = parseMoney(body.amount); if (amount <= 0) throw new Error('Platba musí být kladná.');
        const note = String(body.note || '').trim();
        const personValue = String(body.person_id || '');
        if (personValue.startsWith('group:')) {
          const group = personValue.slice(6);
          const month = monthData(db, body.period);
          const members = month.people.filter((person) => person.payment_group === group);
          if (members.length < 2) throw new Error('Platební skupina neexistuje.');
          const allocations = splitWeighted(amount, members.map((person) => ({
            id: person.id, weight: Math.max(0, person.balance_halere) || 1
          })));
          const insert = db.prepare('INSERT INTO payments(person_id,period,paid_on,amount_halere,note) VALUES (?,?,?,?,?)');
          const ids = [];
          db.exec('BEGIN IMMEDIATE');
          try {
            for (const allocation of allocations) {
              const result = insert.run(allocation.personId, body.period, body.paid_on, allocation.amount, note || 'Společná platba');
              ids.push(Number(result.lastInsertRowid));
            }
            audit(db, 'create', 'group_payment', null, { group, ids, amount_halere: amount, allocations });
            db.exec('COMMIT');
          } catch (error) {
            db.exec('ROLLBACK');
            throw error;
          }
        } else {
          const result = db.prepare('INSERT INTO payments(person_id,period,paid_on,amount_halere,note) VALUES (?,?,?,?,?)')
            .run(Number(personValue), body.period, body.paid_on, amount, note);
          audit(db, 'create', 'payment', Number(result.lastInsertRowid), { ...body, amount_halere: amount });
        }
        return redirect(res, `/admin?view=payments&message=${encodeURIComponent('Platba byla přidána.')}`);
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
        return redirect(res, `/admin?view=meters&message=${encodeURIComponent('Odečet byl uložen.')}`);
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
        const entries = db.prepare('SELECT * FROM audit_log ORDER BY id DESC').all();
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
