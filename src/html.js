'use strict';

const { escapeHtml, formatMoney, formatDecimal, periodLabel } = require('./utils');

function layout({ title, body, session, config, period, message, error, print = false }) {
  const nav = session && !print ? `
    <header class="topbar">
      <a class="brand" href="/?period=${escapeHtml(period || '')}">${escapeHtml(config.householdName)}</a>
      <nav>
        <a href="/?period=${escapeHtml(period || '')}">Přehled</a>
        ${session.role === 'admin' ? '<a href="/calculator">Kalkulačka</a><a href="/admin">Správa</a><a href="/audit">Audit</a>' : ''}
        <form method="post" action="/logout" class="inline"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button class="link-button">Odhlásit</button></form>
      </nav>
    </header>` : '';
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>${escapeHtml(title)} · ${escapeHtml(config.householdName)}</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body class="${print ? 'print-view' : ''}">
${nav}
<main class="container">
${message ? `<div class="notice success">${escapeHtml(message)}</div>` : ''}
${error ? `<div class="notice error">${escapeHtml(error)}</div>` : ''}
${body}
</main>
</body>
</html>`;
}

function loginPage(config, error = '') {
  return layout({
    title: 'Přihlášení',
    config,
    error,
    body: `<section class="login-card">
      <div class="eyebrow">Soukromý účet domácnosti</div>
      <h1>${escapeHtml(config.householdName)}</h1>
      <p>Zadejte čtenářské heslo pro přehled, nebo administrátorské heslo pro správu.</p>
      <form method="post" action="/login" class="stack">
        <label>Heslo<input type="password" name="password" autocomplete="current-password" required autofocus></label>
        <button type="submit">Odemknout</button>
      </form>
      <p class="muted small">Aplikace neposílá data do cloudu. Přístup je navíc omezen na lokální síť, pokud je zapnuté LAN_ONLY.</p>
    </section>`
  });
}

function personCards(people, period, paymentEnabled) {
  return people.map((person) => {
    const cls = person.balance_halere > 0 ? 'owes' : person.balance_halere < 0 ? 'credit' : 'settled';
    const label = person.balance_halere > 0 ? 'Zbývá doplatit' : person.balance_halere < 0 ? 'Přeplatek' : 'Vyrovnáno';
    return `<article class="metric-card ${cls}">
      <div class="metric-name">${escapeHtml(person.name)}${person.is_manager ? ' <span class="tag">správce</span>' : ''}</div>
      <div class="metric-value">${formatMoney(Math.abs(person.balance_halere))}</div>
      <div class="metric-label">${label}</div>
      <dl><div><dt>Předepsáno</dt><dd>${formatMoney(person.due_halere)}</dd></div><div><dt>Zaplaceno</dt><dd>${formatMoney(person.paid_halere)}</dd></div></dl>
      ${paymentEnabled && person.balance_halere > 0 ? `<a class="button secondary payment-button" href="/payment-qr.svg?period=${escapeHtml(period)}&person=${person.id}" target="_blank">QR kód k platbě</a>` : ''}
    </article>`;
  }).join('');
}

function dashboardPage({ config, session, period, data, message, error }) {
  const expenseRows = data.expenses.map((e) => `<tr class="${e.status === 'void' ? 'void' : ''}">
    <td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td>
    <td><strong>${escapeHtml(e.description)}</strong><div class="muted small">${escapeHtml(e.allocation_text)}</div>${e.void_reason ? `<div class="danger small">Storno: ${escapeHtml(e.void_reason)}</div>` : ''}</td>
    <td class="number">${formatMoney(e.amount_halere)}</td>
    <td>${escapeHtml(e.payer_name || '—')}</td>
    ${session.role === 'admin' ? `<td>${e.status === 'active' ? `<form method="post" action="/expenses/${e.id}/void" class="inline"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="period" value="${escapeHtml(period)}"><input class="compact" name="reason" placeholder="Důvod storna" required><button class="danger-button">Storno</button></form>` : 'stornováno'}</td>` : ''}
  </tr>`).join('') || `<tr><td colspan="${session.role === 'admin' ? 6 : 5}" class="empty">V tomto měsíci zatím nejsou žádné položky.</td></tr>`;

  const paymentRows = data.payments.map((p) => `<tr class="${p.status === 'void' ? 'void' : ''}">
    <td>${escapeHtml(p.paid_on)}</td><td>${escapeHtml(p.person_name)}</td><td>${escapeHtml(p.note || '—')}${p.void_reason ? `<div class="danger small">Storno: ${escapeHtml(p.void_reason)}</div>` : ''}</td><td class="number">${formatMoney(p.amount_halere)}</td>
    ${session.role === 'admin' ? `<td>${p.status === 'active' ? `<form method="post" action="/payments/${p.id}/void" class="inline"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="period" value="${escapeHtml(period)}"><input class="compact" name="reason" placeholder="Důvod storna" required><button class="danger-button">Storno</button></form>` : 'stornováno'}</td>` : ''}
  </tr>`).join('') || `<tr><td colspan="${session.role === 'admin' ? 5 : 4}" class="empty">Žádné evidované platby.</td></tr>`;

  const categoryBars = data.categories.map((c) => `<div class="bar-row"><span>${escapeHtml(c.label)}</span><strong>${formatMoney(c.amount_halere)}</strong></div>`).join('') || '<p class="empty">Bez dat.</p>';
  const meterCards = data.meterReadings.map((m) => `<div class="meter"><span>${m.meter_type === 'electricity' ? 'Elektřina' : 'Plyn'}</span><strong>${formatDecimal(m.value)} ${escapeHtml(m.unit)}</strong><small>stav k ${escapeHtml(m.read_on)}</small></div>`).join('') || '<p class="empty">Zatím nebyl uložen žádný odečet.</p>';

  const body = `
    <section class="page-head">
      <div><div class="eyebrow">Měsíční přehled</div><h1>${escapeHtml(periodLabel(period))}</h1><p class="muted">Celkové aktivní náklady: <strong>${formatMoney(data.totalHalere)}</strong></p></div>
      <form method="get" action="/" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form>
    </section>
    <section class="metrics">${personCards(data.people, period, data.paymentEnabled)}</section>
    <section class="two-col">
      <article class="panel"><div class="panel-head"><h2>Struktura nákladů</h2></div>${categoryBars}</article>
      <article class="panel"><div class="panel-head"><h2>Poslední odečty</h2></div><div class="meters">${meterCards}</div></article>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Náklady a rozúčtování</h2><div class="actions"><a class="button secondary" href="/export/month.csv?period=${escapeHtml(period)}">CSV export</a><a class="button secondary" href="/print?period=${escapeHtml(period)}" target="_blank">Tisk / PDF</a></div></div>
      <div class="table-wrap"><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Popis a rozdělení</th><th>Celkem</th><th>Zaplatil</th>${session.role === 'admin' ? '<th>Akce</th>' : ''}</tr></thead><tbody>${expenseRows}</tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>Přijaté platby</h2></div>
      <div class="table-wrap"><table><thead><tr><th>Datum</th><th>Osoba</th><th>Poznámka</th><th>Částka</th>${session.role === 'admin' ? '<th>Akce</th>' : ''}</tr></thead><tbody>${paymentRows}</tbody></table></div>
    </section>`;

  return layout({ title: periodLabel(period), body, session, config, period, message, error });
}

function adminPage({ config, session, people, categories, templates, readings, message, error }) {
  const peopleChecks = people.filter((p) => p.active).map((p) => `<label class="check"><input type="checkbox" name="person_id" value="${p.id}" checked> ${escapeHtml(p.name)} <span class="muted">(váha ${escapeHtml(p.weight)})</span></label>`).join('');
  const personOptions = people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const categoryOptions = categories.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
  const templateRows = templates.map((t) => `<tr class="${t.active ? '' : 'void'}"><td>${escapeHtml(t.category_label)}</td><td>${escapeHtml(t.description)}</td><td>${formatMoney(t.amount_halere)}</td><td>${t.due_day}.</td><td>${escapeHtml(t.people_names)}</td><td>${t.active ? `<form method="post" action="/templates/${t.id}/deactivate"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button class="danger-button">Deaktivovat</button></form>` : 'neaktivní'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Zatím nejsou nastavené pravidelné položky.</td></tr>';
  const peopleRows = people.map((p) => `<tr><td><input form="person-${p.id}" name="name" value="${escapeHtml(p.name)}" required></td><td><input form="person-${p.id}" name="weight" type="number" min="0.01" step="0.01" value="${escapeHtml(p.weight)}" required></td><td><label class="check"><input form="person-${p.id}" type="checkbox" name="active" ${p.active ? 'checked' : ''}> aktivní</label></td><td>${p.is_manager ? 'ano' : '—'}</td><td><form id="person-${p.id}" method="post" action="/people/${p.id}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button>Uložit</button></form></td></tr>`).join('');
  const readingRows = readings.map((r) => `<tr class="${r.status === 'void' ? 'void' : ''}"><td>${escapeHtml(r.read_on)}</td><td>${r.meter_type === 'electricity' ? 'Elektřina' : 'Plyn'}</td><td>${formatDecimal(r.value)} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.note || '—')}</td><td>${r.status === 'active' ? `<form method="post" action="/meters/${r.id}/void"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input class="compact" name="reason" placeholder="Důvod" required><button class="danger-button">Storno</button></form>` : 'stornováno'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Žádné odečty.</td></tr>';

  const body = `<section class="page-head"><div><div class="eyebrow">Administrace</div><h1>Zadávání a nastavení</h1><p class="muted">Změny se zapisují do auditní stopy. Chybné finanční položky se nemažou, ale stornují.</p></div></section>
  <section class="admin-grid">
    <article class="panel"><h2>Nový náklad / vyúčtování</h2><form method="post" action="/expenses" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <div class="form-grid"><label>Datum<input type="date" name="occurred_on" required></label><label>Účetní měsíc<input type="month" name="period" required></label></div>
      <label>Kategorie<select name="category_code">${categoryOptions}</select></label>
      <label>Popis<input name="description" required placeholder="Např. záloha PRE / olej do kuchyně"></label>
      <label>Částka v Kč<input name="amount" inputmode="decimal" required placeholder="Lze i záporně, např. -1250,50"></label>
      <label>Zaplatil<select name="paid_by_person_id"><option value="">Neuvádět / hrazeno správcem</option>${personOptions}</select></label>
      <fieldset><legend>Rozdělit mezi</legend><div class="checks">${peopleChecks}</div><p class="muted small">Použijí se aktuální váhy osob; konkrétní částky se uloží napevno do historie.</p></fieldset>
      <button>Přidat položku</button>
    </form></article>

    <article class="panel"><h2>Zaevidovat platbu spolubydlícího</h2><form method="post" action="/payments" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <label>Osoba<select name="person_id">${personOptions}</select></label>
      <div class="form-grid"><label>Datum<input type="date" name="paid_on" required></label><label>Měsíc, proti kterému platba jde<input type="month" name="period" required></label></div>
      <label>Částka v Kč<input name="amount" inputmode="decimal" required></label><label>Poznámka<input name="note" placeholder="Nájem srpen"></label>
      <button>Přidat platbu</button>
    </form></article>

    <article class="panel"><h2>Odečet měřidla</h2><form method="post" action="/meters" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <div class="form-grid"><label>Typ<select name="meter_type"><option value="electricity">Elektřina</option><option value="gas">Plyn</option></select></label><label>Datum<input type="date" name="read_on" required></label></div>
      <div class="form-grid"><label>Stav<input name="value" inputmode="decimal" required></label><label>Jednotka<input name="unit" value="kWh" required></label></div>
      <label>Poznámka<input name="note" placeholder="Fotografie uložena v…"></label><button>Uložit odečet</button>
    </form></article>

    <article class="panel"><h2>Vygenerovat pravidelné položky</h2><form method="post" action="/generate" class="stack"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><label>Měsíc<input type="month" name="period" required></label><button>Vygenerovat bez duplicit</button></form></article>
  </section>

  <section class="panel"><div class="panel-head"><h2>Pravidelné měsíční položky</h2></div>
    <form method="post" action="/templates" class="template-form"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><select name="category_code">${categoryOptions}</select><input name="description" placeholder="Popis" required><input name="amount" placeholder="Kč" required><input name="due_day" type="number" min="1" max="28" value="1" required><div class="checks">${peopleChecks}</div><button>Přidat šablonu</button></form>
    <div class="table-wrap"><table><thead><tr><th>Kategorie</th><th>Popis</th><th>Částka</th><th>Den</th><th>Osoby</th><th>Akce</th></tr></thead><tbody>${templateRows}</tbody></table></div>
  </section>

  <section class="panel"><div class="panel-head"><h2>Obyvatelé a výchozí podíly</h2></div><div class="table-wrap"><table><thead><tr><th>Jméno</th><th>Váha</th><th>Stav</th><th>Správce</th><th></th></tr></thead><tbody>${peopleRows}</tbody></table></div></section>
  <section class="panel"><div class="panel-head"><h2>Historie odečtů</h2></div><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Typ</th><th>Stav</th><th>Poznámka</th><th>Akce</th></tr></thead><tbody>${readingRows}</tbody></table></div></section>`;

  return layout({ title: 'Správa', body, session, config, message, error });
}

function calculatorPage({ config, session, period, data, message, error }) {
  const rules = [
    ['equal', 'Stejně na osobu'],
    ['area_common', 'Pokoj + stejný díl společných prostor'],
    ['private_area', 'Jen podle plochy pokoje'],
    ['weights', 'Podle ručních vah']
  ];
  const ruleOptions = (selected) => rules.map(([value, label]) =>
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  const peopleInputs = data.people.map((person) => `<label>${escapeHtml(person.name)}
    <input type="number" min="0" step="0.01" name="person_area_${person.id}" value="${escapeHtml(person.private_area_m2)}" required>
    <span class="muted small">m² soukromé plochy</span>
  </label>`).join('');
  const costInputs = data.costs.map((cost) => `<div class="cost-rule">
    <label>${escapeHtml(cost.label)}<input name="cost_amount_${escapeHtml(cost.code)}" inputmode="decimal" value="${(cost.amount_halere / 100).toFixed(2)}" required></label>
    <label>Rozdělení<select name="cost_rule_${escapeHtml(cost.code)}">${ruleOptions(cost.allocation_rule)}</select></label>
  </div>`).join('');
  const totalCosts = data.lines.reduce((sum, line) => sum + line.amount_halere, 0);
  const preview = data.totals.map((person) => {
    const details = data.lines.map((line) => {
      const amount = line.allocations.find((item) => item.personId === person.id)?.amount || 0;
      return `<li><span>${escapeHtml(line.label)}</span><strong>${formatMoney(amount)}</strong></li>`;
    }).join('');
    return `<article class="metric-card">
      <div class="metric-name">${escapeHtml(person.name)}</div>
      <div class="metric-value">${formatMoney(person.amount_halere)}</div>
      <div class="metric-label">měsíční předpis</div>
      <ul class="allocation-list">${details}</ul>
    </article>`;
  }).join('');
  const generation = data.generated
    ? `<div class="notice success">Předpis pro ${escapeHtml(periodLabel(period))} už byl vytvořen. Znovu jej vytvořit nelze, aby nevznikly duplicity.</div>`
    : `<form method="post" action="/calculator/generate" class="generate-box">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <input type="hidden" name="period" value="${escapeHtml(period)}">
        <div><strong>Zaúčtovat tento návrh</strong><p class="muted small">Vznikne pět pevných položek a částky se propíšou do účtů nájemníků.</p></div>
        <button>Vytvořit předpis pro ${escapeHtml(periodLabel(period))}</button>
      </form>`;
  const body = `
    <section class="page-head">
      <div><div class="eyebrow">Rozpočítání nájmu</div><h1>Kalkulačka domácnosti</h1><p class="muted">Nejdřív upravte pravidla a uložte náhled. Teprve potom jej jedním tlačítkem zaúčtujte.</p></div>
      <form method="get" action="/calculator" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form>
    </section>
    <section class="calculator-layout">
      <article class="panel calculator-settings">
        <h2>Vstupy a pravidla</h2>
        <form method="post" action="/calculator/settings" class="stack">
          <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
          <input type="hidden" name="period" value="${escapeHtml(period)}">
          <div class="area-summary">
            <label>Celková plocha bytu<input type="number" min="1" step="0.01" name="total_area_m2" value="${escapeHtml(data.totalArea)}" required></label>
            <div><span>Soukromé pokoje</span><strong>${formatDecimal(data.privateArea, 2)} m²</strong></div>
            <div><span>Společná plocha</span><strong>${formatDecimal(data.commonArea, 2)} m²</strong></div>
          </div>
          <fieldset><legend>Soukromá plocha připadající na osobu</legend><div class="form-grid">${peopleInputs}</div></fieldset>
          <fieldset><legend>Měsíční náklady a způsob rozdělení</legend><div class="stack">${costInputs}</div></fieldset>
          <fieldset><legend>QR platby na účet správce</legend>
            <div class="form-grid"><label>Český IBAN<input name="payment_iban" value="${escapeHtml(data.paymentIban)}" placeholder="CZ6508000000192000145399"></label>
            <label>Den splatnosti<input type="number" min="1" max="28" name="payment_due_day" value="${escapeHtml(data.paymentDueDay)}" required></label></div>
            <p class="muted small">IBAN zůstává jen v této aplikaci. Bez něj se platební QR kódy nezobrazí.</p>
          </fieldset>
          <button>Uložit a přepočítat náhled</button>
        </form>
      </article>
      <div>
        <article class="panel calculator-total"><span>Celkové měsíční náklady</span><strong>${formatMoney(totalCosts)}</strong><small>Součet všech pěti položek</small></article>
        <section class="metrics calculator-preview">${preview}</section>
        <article class="panel">${generation}</article>
      </div>
    </section>`;
  return layout({ title: 'Kalkulačka', body, session, config, period, message, error });
}

function auditPage({ config, session, entries }) {
  const rows = entries.map((e) => `<tr><td>${escapeHtml(e.created_at)}</td><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}</td><td><code>${escapeHtml(e.details_json)}</code></td></tr>`).join('');
  return layout({ title: 'Audit', session, config, body: `<section class="page-head"><div><div class="eyebrow">Transparentnost</div><h1>Auditní stopa</h1><p class="muted">Posledních 500 administrátorských operací.</p></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Čas</th><th>Akce</th><th>Entita</th><th>Detaily</th></tr></thead><tbody>${rows}</tbody></table></div></section>` });
}

function printPage({ config, period, data }) {
  const summary = data.people.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${formatMoney(p.due_halere)}</td><td>${formatMoney(p.paid_halere)}</td><td>${formatMoney(p.balance_halere)}</td></tr>`).join('');
  const rows = data.expenses.filter((e) => e.status === 'active').map((e) => `<tr><td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.allocation_text)}</td><td>${formatMoney(e.amount_halere)}</td></tr>`).join('');
  return layout({ print: true, title: `Přehled ${period}`, config, body: `<section class="print-head"><div><h1>${escapeHtml(config.householdName)}</h1><p>Měsíční rozúčtování · ${escapeHtml(periodLabel(period))}</p></div><button onclick="window.print()">Vytisknout / uložit PDF</button></section><h2>Souhrn osob</h2><table><thead><tr><th>Osoba</th><th>Předepsáno</th><th>Zaplaceno</th><th>Zbývá</th></tr></thead><tbody>${summary}</tbody></table><h2>Položky</h2><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Popis</th><th>Rozdělení</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table><p class="print-total">Celkové náklady: ${formatMoney(data.totalHalere)}</p>` });
}

module.exports = { layout, loginPage, dashboardPage, adminPage, auditPage, printPage, calculatorPage };
