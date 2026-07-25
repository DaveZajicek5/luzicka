'use strict';

const { escapeHtml, formatMoney, formatDecimal, periodLabel } = require('./utils');

function layout({ title, body, session, config, period, message, error, print = false }) {
  const nav = session && !print ? `
    <header class="topbar">
      <a class="brand" href="/?period=${escapeHtml(period || '')}">${escapeHtml(config.householdName)}</a>
      <nav>
        <a href="/?period=${escapeHtml(period || '')}">Přehled</a>
        ${session.role === 'admin' ? '<a href="/calculator">Nájmy</a><a href="/admin">Správa</a><a href="/audit">Audit</a>' : ''}
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
      ${person.payment_group_names?.includes(' + ') ? `<div class="muted small">Platba společně: ${escapeHtml(person.payment_group_names)}</div>` : ''}
      ${paymentEnabled && person.payment_group_representative && person.payment_group_balance_halere > 0 ? `<a class="button secondary payment-button" href="/payment-qr.svg?period=${escapeHtml(period)}&person=${person.id}" target="_blank">QR kód: ${formatMoney(person.payment_group_balance_halere)}</a>` : ''}
    </article>`;
  }).join('');
}

function dashboardPage({ config, session, period, data, message, error }) {
  const expenseRows = data.expenses.map((e) => `<tr class="${e.status === 'void' ? 'void' : ''}">
    <td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td>
    <td><strong>${escapeHtml(e.description)}</strong><div class="muted small">${escapeHtml(e.allocation_text)}</div>${e.attachment_count ? `<a class="small" href="/expenses/${e.id}/attachment" target="_blank">📎 Otevřít přílohu</a>` : ''}${e.void_reason ? `<div class="danger small">Storno: ${escapeHtml(e.void_reason)}</div>` : ''}</td>
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
  const reminders = data.reminders.map((reminder) => `<div class="notice reminder">${escapeHtml(reminder)}</div>`).join('');

  const body = `
    <section class="page-head">
      <div><div class="eyebrow">Měsíční přehled</div><h1>${escapeHtml(periodLabel(period))}</h1><p class="muted">Celkové aktivní náklady: <strong>${formatMoney(data.totalHalere)}</strong></p></div>
      <form method="get" action="/" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form>
    </section>
    ${reminders}
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
  const grouped = new Set();
  const groupOptions = people.filter((p) => p.payment_group && !grouped.has(p.payment_group) && grouped.add(p.payment_group))
    .map((p) => {
      const members = people.filter((member) => member.payment_group === p.payment_group);
      return members.length > 1 ? `<option value="group:${escapeHtml(p.payment_group)}">${escapeHtml(members.map((member) => member.name).join(' + '))} (společně)</option>` : '';
    }).join('');
  const personOptions = groupOptions + people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const categoryOptions = categories.map((c) => `<option value="${escapeHtml(c.code)}">${escapeHtml(c.label)}</option>`).join('');
  const templateRows = templates.map((t) => `<tr class="${t.active ? '' : 'void'}"><td>${escapeHtml(t.category_label)}</td><td>${escapeHtml(t.description)}</td><td>${formatMoney(t.amount_halere)}</td><td>${t.due_day}.</td><td>${escapeHtml(t.people_names)}</td><td>${t.active ? `<form method="post" action="/templates/${t.id}/deactivate"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button class="danger-button">Deaktivovat</button></form>` : 'neaktivní'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Zatím nejsou nastavené pravidelné položky.</td></tr>';
  const peopleRows = people.map((p) => `<tr><td><input form="person-${p.id}" name="name" value="${escapeHtml(p.name)}" required></td><td><input form="person-${p.id}" name="weight" type="number" min="0.01" step="0.01" value="${escapeHtml(p.weight)}" required></td><td><label class="check"><input form="person-${p.id}" type="checkbox" name="active" ${p.active ? 'checked' : ''}> aktivní</label></td><td>${p.is_manager ? 'ano' : '—'}</td><td><form id="person-${p.id}" method="post" action="/people/${p.id}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button>Uložit</button></form></td></tr>`).join('');
  const readingRows = readings.map((r) => `<tr class="${r.status === 'void' ? 'void' : ''}"><td>${escapeHtml(r.read_on)}</td><td>${r.meter_type === 'electricity' ? 'Elektřina' : 'Plyn'}</td><td>${formatDecimal(r.value)} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.note || '—')}</td><td>${r.status === 'active' ? `<form method="post" action="/meters/${r.id}/void"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input class="compact" name="reason" placeholder="Důvod" required><button class="danger-button">Storno</button></form>` : 'stornováno'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Žádné odečty.</td></tr>';

  const body = `<section class="page-head"><div><div class="eyebrow">Administrace</div><h1>Zadávání a nastavení</h1><p class="muted">Změny se zapisují do auditní stopy. Chybné finanční položky se nemažou, ale stornují.</p></div></section>
  <section class="admin-grid">
    <article class="panel" id="new-expense"><h2>Mimořádný náklad nebo vratka</h2><form method="post" action="/expenses" enctype="multipart/form-data" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <label>Typ položky<select name="entry_type"><option value="charge">Doplatek / další náklad (+)</option><option value="credit">Sleva / přeplatek / vratka (−)</option></select></label>
      <div class="form-grid"><label>Datum<input type="date" name="occurred_on" required></label><label>Účetní měsíc<input type="month" name="period" required></label></div>
      <label>Kategorie<select name="category_code">${categoryOptions}</select></label>
      <label>Popis<input name="description" required placeholder="Např. záloha PRE / olej do kuchyně"></label>
      <label>Částka v Kč<input name="amount" inputmode="decimal" required placeholder="Např. 1250,50"><span class="muted small">Zadávejte kladné číslo; znaménko určí zvolený typ položky.</span></label>
      <label>Zaplatil<select name="paid_by_person_id"><option value="">Neuvádět / hrazeno správcem</option>${personOptions}</select></label>
      <label>Příloha (volitelně)<input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"><span class="muted small">PDF nebo fotografie, maximálně 10 MB.</span></label>
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

function weekdayOptions(selected) {
  return [['', 'Zatím neznámý'], ['1', 'Pondělí'], ['2', 'Úterý'], ['3', 'Středa'], ['4', 'Čtvrtek'], ['5', 'Pátek'], ['6', 'Sobota'], ['0', 'Neděle']]
    .map(([value, label]) => `<option value="${value}" ${String(selected) === value ? 'selected' : ''}>${label}</option>`).join('');
}

function calculatorPage({ config, session, period, data, message, error }) {
  const totalCosts = data.lines.reduce((sum, line) => sum + line.amount_halere, 0);
  const header = data.totals.map((person) => `<th>${escapeHtml(person.name.split(' ')[0])}</th>`).join('');
  const rows = data.lines.map((line) => `<tr>
    <td><strong>${escapeHtml(line.label)}</strong><small>${allocationRuleLabel(line.allocation_rule)}</small></td>
    <td class="number">${formatMoney(line.amount_halere)}</td>
    ${data.totals.map((person) => {
      const amount = line.allocations.find((item) => item.personId === person.id)?.amount || 0;
      return `<td class="number">${formatMoney(amount)}</td>`;
    }).join('')}
  </tr>`).join('');
  const totals = `<tr class="total-row"><td>Celkem za měsíc</td><td class="number">${formatMoney(totalCosts)}</td>
    ${data.totals.map((person) => `<td class="number">${formatMoney(person.amount_halere)}</td>`).join('')}</tr>`;
  const grouped = [];
  for (const person of data.totals) {
    const key = person.payment_group || `person-${person.id}`;
    let group = grouped.find((item) => item.key === key);
    if (!group) { group = { key, names: [], amount: 0 }; grouped.push(group); }
    group.names.push(person.name);
    group.amount += person.amount_halere;
  }
  const payers = grouped.map((group) => `<article class="payer-card">
    <span>${escapeHtml(group.names.join(' + '))}</span><strong>${formatMoney(group.amount)}</strong>
    <small>${group.names.length > 1 ? 'jedna společná platba' : 'samostatná platba'}</small>
  </article>`).join('');
  const generation = data.generated
    ? `<div class="completion-state"><div class="completion-icon">✓</div><div><strong>Tento měsíc je zaúčtovaný</strong><p>Částky už jsou v účtech nájemníků. Platby se evidují zvlášť.</p></div>
        <a class="button secondary" href="/?period=${escapeHtml(period)}">Otevřít přehled</a>
        <form method="post" action="/calculator/reopen" class="reopen-form"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="period" value="${escapeHtml(period)}"><input type="hidden" name="reason" value="Vráceno k opravě předpisu"><button class="danger-button">Vrátit k úpravě</button></form>
      </div>`
    : `<form method="post" action="/calculator/generate" class="primary-action">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="period" value="${escapeHtml(period)}">
        <div><span class="eyebrow">Poslední krok</span><strong>Zaúčtovat ${formatMoney(totalCosts)}</strong><p>Vytvoří se ${data.lines.length} položek a připíšou se částky nájemníkům.</p></div>
        <button>Zaúčtovat ${escapeHtml(periodLabel(period))}</button>
      </form>`;
  const body = `
    <section class="page-head compact-head">
      <div><div class="eyebrow">Měsíční předpis</div><h1>${escapeHtml(periodLabel(period))}</h1><p class="muted">Zkontrolujte rozdělení a potom měsíc zaúčtujte.</p></div>
      <div class="page-actions"><a class="button secondary" href="/calculator/settings?period=${escapeHtml(period)}">Upravit nastavení</a>
      <form method="get" action="/calculator" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form></div>
    </section>
    <section class="billing-hero"><div><span>Celkem domácnost</span><strong>${formatMoney(totalCosts)}</strong><small>${data.lines.length} pravidelných nákladů</small></div><div class="payer-grid">${payers}</div></section>
    <section class="panel">
      <div class="panel-head"><div><h2>Kontrola rozdělení</h2><p class="muted small">Každý řádek ukazuje celkový náklad a přesný podíl každého obyvatele.</p></div></div>
      <div class="table-wrap allocation-matrix"><table><thead><tr><th>Náklad</th><th>Celkem</th>${header}</tr></thead><tbody>${rows}${totals}</tbody></table></div>
    </section>
    <section class="panel action-panel">${generation}</section>
    <section class="panel adjustment-guide">
      <div class="panel-head"><div><h2>Mimořádné položky</h2><p class="muted small">Přidávají se k již vytvořenému předpisu; není kvůli nim potřeba celý měsíc rušit.</p></div><a class="button secondary" href="/admin#new-expense">Přidat položku</a></div>
      <div class="guidance-grid">
        <div><strong>Dodatečný náklad</strong><p>Například oprava nebo doplatek vyúčtování. Zvýší částku k úhradě.</p></div>
        <div><strong>Sleva nebo přeplatek</strong><p>Zadejte jako vratku. Sníží dluh, případně vytvoří přeplatek.</p></div>
        <div><strong>Přijatá platba</strong><p>Nemění náklady. Jen snižuje zbývající částku konkrétního měsíce.</p></div>
      </div>
    </section>`;
  return layout({ title: 'Měsíční předpis', body, session, config, period, message, error });
}

function allocationRuleLabel(rule) {
  return ({
    equal: 'stejně na osobu',
    area_common: 'pokoj + ⅓ společných prostor',
    private_area: 'podle pokoje',
    weights: 'podle vah'
  })[rule] || rule;
}

function calculatorSettingsPage({ config, session, period, data, message, error }) {
  const rules = [
    ['equal', 'Stejně na osobu'],
    ['area_common', 'Podle pokoje + společné prostory po pokojích'],
    ['private_area', 'Jen podle plochy pokoje'],
    ['weights', 'Podle ručních vah']
  ];
  const ruleOptions = (selected) => rules.map(([value, label]) =>
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  const roomInputs = data.rooms.map((room) => `<div class="room-rule">
    <label>Název<input name="room_name_${room.id}" value="${escapeHtml(room.name)}" required></label>
    <label>Délka (m)<input type="number" min=".01" step=".01" name="room_length_${room.id}" value="${escapeHtml(room.length_m)}" required></label>
    <label>Šířka (m)<input type="number" min=".01" step=".01" name="room_width_${room.id}" value="${escapeHtml(room.width_m)}" required></label>
    <div><span>${escapeHtml(room.people_names || 'bez obyvatel')}</span><strong>${formatDecimal(room.area_m2, 2)} m²</strong></div>
  </div>`).join('');
  const costInputs = data.costs.map((cost) => `<div class="cost-rule">
    <label>${escapeHtml(cost.label)}<input name="cost_amount_${escapeHtml(cost.code)}" inputmode="decimal" value="${(cost.amount_halere / 100).toFixed(2)}" required></label>
    <label>Rozdělení<select name="cost_rule_${escapeHtml(cost.code)}">${ruleOptions(cost.allocation_rule)}</select></label>
  </div>`).join('');
  const body = `
    <section class="page-head">
      <div><div class="eyebrow">Nastavení domácnosti</div><h1>Pravidla a údaje</h1><p class="muted">Tyto hodnoty měňte jen při změně smlouvy, cen, pokoje nebo svozu.</p></div>
      <a class="button secondary" href="/calculator?period=${escapeHtml(period)}">← Zpět na měsíční předpis</a>
    </section>
    <section class="settings-shell">
      <aside class="settings-summary">
        <span>Byt</span><strong>${formatDecimal(data.totalArea, 2)} m²</strong>
        <dl><div><dt>Pokoje</dt><dd>${formatDecimal(data.privateArea, 2)} m²</dd></div><div><dt>Společné</dt><dd>${formatDecimal(data.commonArea, 2)} m²</dd></div></dl>
        <p>Změny se nejdřív projeví v náhledu. Již zaúčtované měsíce zůstanou beze změny.</p>
      </aside>
      <article class="panel settings-form">
        <form method="post" action="/calculator/settings" class="stack">
          <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
          <input type="hidden" name="period" value="${escapeHtml(period)}">
          <section class="settings-section"><div class="section-heading"><span>1</span><div><h2>Pokoje</h2><p>Rozměry určují podíl na nájmu.</p></div></div>
            <label class="short-field">Celková plocha bytu (m²)<input type="number" min="1" step="0.01" name="total_area_m2" value="${escapeHtml(data.totalArea)}" required></label>
            <div class="stack">${roomInputs}</div><p class="muted small">Společný pokoj se mezi Davida a Anežku rozdělí napůl.</p>
          </section>
          <section class="settings-section"><div class="section-heading"><span>2</span><div><h2>Pravidelné náklady</h2><p>Částka a pravidlo rozdělení pro každý měsíc.</p></div></div><div class="stack">${costInputs}</div></section>
          <section class="settings-section"><div class="section-heading"><span>3</span><div><h2>Platby</h2><p>Účet pro QR kódy a termín splatnosti.</p></div></div>
            <div class="form-grid"><label>Český IBAN<input name="payment_iban" value="${escapeHtml(data.paymentIban)}" placeholder="CZ6508000000192000145399"></label>
            <label>Den splatnosti<input type="number" min="1" max="28" name="payment_due_day" value="${escapeHtml(data.paymentDueDay)}" required></label></div>
            <p class="muted small">David a Anežka mají jednu společnou platbu. IBAN zůstává jen v této aplikaci.</p>
          </section>
          <details class="settings-section"><summary><span class="section-number">4</span><div><h2>Svoz odpadu</h2><p>Volitelné – nastavíme, až vypozorujete pravidelnost.</p></div></summary>
            <div class="waste-grid">
              <strong>Směsný odpad</strong>
              <label>Den<select name="waste_mixed_weekday">${weekdayOptions(data.wasteMixedWeekday)}</select></label>
              <label>Každých<input type="number" min="1" max="8" name="waste_mixed_interval_weeks" value="${escapeHtml(data.wasteMixedIntervalWeeks)}"> týdnů</label>
              <label>Známé datum svozu<input type="date" name="waste_mixed_anchor_date" value="${escapeHtml(data.wasteMixedAnchorDate)}"></label>
              <strong>Tříděný odpad</strong>
              <label>Den<select name="waste_sorted_weekday">${weekdayOptions(data.wasteSortedWeekday)}</select></label>
              <label>Každých<input type="number" min="1" max="8" name="waste_sorted_interval_weeks" value="${escapeHtml(data.wasteSortedIntervalWeeks)}"> týdnů</label>
              <label>Známé datum svozu<input type="date" name="waste_sorted_anchor_date" value="${escapeHtml(data.wasteSortedAnchorDate)}"></label>
            </div>
          </details>
          <div class="save-bar"><a href="/calculator?period=${escapeHtml(period)}">Zrušit</a><button>Uložit změny a přepočítat</button></div>
        </form>
      </article>
    </section>`;
  return layout({ title: 'Nastavení domácnosti', body, session, config, period, message, error });
}

function auditPage({ config, session, entries }) {
  const rows = entries.map((e) => `<tr><td>${escapeHtml(e.created_at)}</td><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}</td><td><code>${escapeHtml(e.details_json)}</code></td></tr>`).join('');
  return layout({ title: 'Audit', session, config, body: `<section class="page-head"><div><div class="eyebrow">Transparentnost</div><h1>Auditní stopa</h1><p class="muted">Kompletní historie administrátorských operací.</p></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Čas</th><th>Akce</th><th>Entita</th><th>Detaily</th></tr></thead><tbody>${rows}</tbody></table></div></section>` });
}

function printPage({ config, period, data }) {
  const summary = data.people.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${formatMoney(p.due_halere)}</td><td>${formatMoney(p.paid_halere)}</td><td>${formatMoney(p.balance_halere)}</td></tr>`).join('');
  const rows = data.expenses.filter((e) => e.status === 'active').map((e) => `<tr><td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.allocation_text)}</td><td>${formatMoney(e.amount_halere)}</td></tr>`).join('');
  return layout({ print: true, title: `Přehled ${period}`, config, body: `<section class="print-head"><div><h1>${escapeHtml(config.householdName)}</h1><p>Měsíční rozúčtování · ${escapeHtml(periodLabel(period))}</p></div><button onclick="window.print()">Vytisknout / uložit PDF</button></section><h2>Souhrn osob</h2><table><thead><tr><th>Osoba</th><th>Předepsáno</th><th>Zaplaceno</th><th>Zbývá</th></tr></thead><tbody>${summary}</tbody></table><h2>Položky</h2><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Popis</th><th>Rozdělení</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table><p class="print-total">Celkové náklady: ${formatMoney(data.totalHalere)}</p>` });
}

module.exports = { layout, loginPage, dashboardPage, adminPage, auditPage, printPage, calculatorPage, calculatorSettingsPage };
