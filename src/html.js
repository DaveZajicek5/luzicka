'use strict';

const {
  escapeHtml, formatMoney, formatDecimal, periodLabel, currentPeriod, nextPeriod
} = require('./utils');

function layout({ title, body, session, config, period, message, error, print = false }) {
  const nav = session && !print ? `
    <header class="topbar">
      <a class="brand" href="/?period=${escapeHtml(period || '')}">${escapeHtml(config.householdName)}</a>
      <nav>
        <a href="/?period=${escapeHtml(period || '')}">Přehled</a>
        <a href="/one-off">Přidat náklad</a>
        ${session.role === 'admin' ? '<a href="/calculator">Vyúčtování</a><a href="/admin">Správa</a><a href="/audit">Audit</a>' : ''}
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

function statementCards(people, period, paymentEnabled, session, ready) {
  const groups = [];
  for (const person of people) {
    const key = person.payment_group || `person-${person.id}`;
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, people: [], due: 0, paid: 0, balance: 0 };
      groups.push(group);
    }
    group.people.push(person);
    group.due += person.due_halere;
    group.paid += person.paid_halere;
    group.balance += person.balance_halere;
  }

  return groups.map((group) => {
    const representative = group.people[0];
    const names = group.people.map((person) => person.name).join(' + ');
    const confirmed = group.people.every((person) => person.confirmed_at);
    const cls = group.balance > 0 ? 'owes' : group.balance < 0 ? 'credit' : 'settled';
    const label = group.balance > 0 ? 'K úhradě' : group.balance < 0 ? 'Přeplatek' : 'Vyrovnáno';
    const confirmations = group.people.map((person) =>
      `<input type="hidden" name="person_id" value="${person.id}">`).join('');
    const creditActions = session.role === 'admin' ? group.people.filter((person) => person.balance_halere < 0).map((person) =>
      `<form method="post" action="/credits/transfer" class="credit-action">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <input type="hidden" name="source_period" value="${escapeHtml(period)}">
        <input type="hidden" name="target_period" value="${escapeHtml(nextPeriod(period))}">
        <input type="hidden" name="person_id" value="${person.id}">
        <button class="secondary">Převést ${escapeHtml(person.name.split(' ')[0])}: ${formatMoney(-person.balance_halere)} do ${escapeHtml(periodLabel(nextPeriod(period)))}</button>
      </form>`).join('') : '';
    let action = '';
    if (!ready) {
      action = '<div class="status-badge pending-badge">Vyúčtování ještě připravuje správce</div>';
    } else if (group.balance > 0 && !confirmed) {
      action = `<form method="post" action="/statements/confirm" class="statement-action">
        <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
        <input type="hidden" name="period" value="${escapeHtml(period)}">${confirmations}
        <button>Potvrdit vyúčtování</button>
      </form>`;
    } else if (group.balance > 0 && confirmed && paymentEnabled) {
      action = `<div class="confirmed-row"><span class="status-badge success-badge">✓ Potvrzeno</span>
        <a class="button payment-button" href="/payment-qr.svg?period=${escapeHtml(period)}&person=${representative.id}" target="_blank">QR kód k platbě</a></div>`;
    } else if (group.balance > 0 && confirmed) {
      action = '<div class="status-badge success-badge">✓ Potvrzeno · účet pro QR zatím není nastavený</div>';
    } else if (group.balance < 0) {
      action = `<div class="status-badge credit-badge">Nic neposílejte · přeplatek lze převést jako slevu do příštího měsíce</div>${creditActions}`;
    } else {
      action = '<div class="status-badge success-badge">✓ Hotovo</div>';
    }
    return `<article class="statement-card ${cls}">
      <div class="statement-card-head"><div><span>Vyúčtování pro</span><h2>${escapeHtml(names)}</h2></div><span class="statement-state">${!ready ? 'připravuje se' : confirmed ? 'potvrzeno' : 'čeká na kontrolu'}</span></div>
      <div class="statement-amount"><span>${label}</span><strong>${formatMoney(Math.abs(group.balance))}</strong></div>
      <dl><div><dt>Podíl na nákladech</dt><dd>${formatMoney(group.due)}</dd></div><div><dt>Už zaplaceno</dt><dd>${formatMoney(group.paid)}</dd></div></dl>
      ${action}
    </article>`;
  }).join('');
}

function dashboardPage({ config, session, period, data, message, error }) {
  const activeExpenses = data.expenses.filter((expense) => expense.status === 'active');
  const voidExpenses = data.expenses.filter((expense) => expense.status === 'void');
  const expenseRows = activeExpenses.map((expense) => `<div class="statement-line">
    <div class="line-main"><span class="line-category">${escapeHtml(expense.category_label)}</span><strong>${escapeHtml(expense.description)}</strong>
      <small>${escapeHtml(expense.occurred_on)}${expense.payer_name ? ` · hradil/a ${escapeHtml(expense.payer_name)}` : ''}</small></div>
    <div class="line-amount">${formatMoney(expense.amount_halere)}</div>
    <details><summary>Jak je částka rozdělená</summary><p>${escapeHtml(expense.allocation_text)}</p>
      ${expense.attachment_count ? `<a href="/expenses/${expense.id}/attachment" target="_blank">Otevřít přílohu</a>` : ''}
      ${session.role === 'admin' ? `<form method="post" action="/expenses/${expense.id}/void" class="void-form"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input type="hidden" name="period" value="${escapeHtml(period)}"><input name="reason" placeholder="Proč položku rušíte?" required><button class="danger-button">Stornovat položku</button></form>` : ''}
    </details>
  </div>`).join('') || '<p class="empty">Pro tento měsíc zatím není vytvořené vyúčtování.</p>';
  const voidRows = voidExpenses.map((expense) => `<li><span>${escapeHtml(expense.description)}</span><strong>${formatMoney(expense.amount_halere)}</strong><small>${escapeHtml(expense.void_reason || 'stornováno')}</small></li>`).join('');
  const paymentRows = data.payments.filter((payment) => payment.status === 'active').map((payment) =>
    `<li><span><strong>${escapeHtml(payment.person_name)}</strong><small>${escapeHtml(payment.paid_on)} · ${escapeHtml(payment.note || 'bez poznámky')}</small></span><strong>${formatMoney(payment.amount_halere)}</strong></li>`
  ).join('') || '<li class="empty">Zatím nebyla zaznamenána žádná platba.</li>';
  const reminders = data.reminders.map((reminder) => `<div class="notice reminder">${escapeHtml(reminder)}</div>`).join('');

  const body = `
    <section class="page-head statement-head">
      <div><div class="eyebrow">Vyúčtování domácnosti</div><h1>${escapeHtml(periodLabel(period))}</h1><p class="muted">Zkontrolujte položky, potvrďte svůj souhrn a potom použijte QR kód.</p></div>
      <form method="get" action="/" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form>
    </section>
    ${reminders}
    <ol class="workflow-steps"><li class="active"><span>1</span>Zkontrolovat náklady</li><li><span>2</span>Potvrdit souhrn</li><li><span>3</span>Zaplatit přes QR</li></ol>
    <section class="statement-layout">
      <article class="panel cost-list">
        <div class="panel-head"><div><h2>Co se tento měsíc platí</h2><p class="muted small">${activeExpenses.length} položek · celkem ${formatMoney(data.totalHalere)}</p></div><div class="actions"><a class="button secondary" href="/one-off">Přidat náklad</a>${session.role === 'admin' ? `<a class="button secondary" href="/calculator?period=${escapeHtml(period)}">Upravit vyúčtování</a>` : ''}</div></div>
        <div class="statement-lines">${expenseRows}</div>
        ${voidRows ? `<details class="void-list"><summary>Stornované položky (${voidExpenses.length})</summary><ul>${voidRows}</ul></details>` : ''}
      </article>
      <aside class="statement-summary">
        <div class="summary-title"><span>2–3</span><div><h2>Potvrzení a platba</h2><p>Vyberte svůj účet.</p></div></div>
        <div class="statement-cards">${statementCards(data.people, period, data.paymentEnabled, session, data.generated)}</div>
      </aside>
    </section>
    <details class="panel secondary-detail"><summary>Další možnosti a historie plateb</summary>
      <div class="detail-actions"><a href="/export/month.csv?period=${escapeHtml(period)}">Stáhnout CSV</a><a href="/print?period=${escapeHtml(period)}" target="_blank">Tisk / PDF</a></div>
      <h3>Přijaté platby</h3><ul class="payment-history">${paymentRows}</ul>
    </details>`;

  return layout({ title: periodLabel(period), body, session, config, period, message, error });
}

function oneOffForm({ session, people, categories, period }) {
  const grouped = new Set();
  const groupOptions = people.filter((person) => person.payment_group && !grouped.has(person.payment_group) && grouped.add(person.payment_group))
    .map((person) => {
      const members = people.filter((member) => member.payment_group === person.payment_group);
      return members.length > 1 ? `<option value="${person.id}">${escapeHtml(members.map((member) => member.name).join(' + '))} (společně)</option>` : '';
    }).join('');
  const personOptions = groupOptions + people.map((person) => `<option value="${person.id}">${escapeHtml(person.name)}</option>`).join('');
  const categoryOptions = categories.map((category) => `<option value="${escapeHtml(category.code)}">${escapeHtml(category.label)}</option>`).join('');
  const peopleChecks = people.filter((person) => person.active).map((person) =>
    `<label class="check"><input type="checkbox" name="person_id" value="${person.id}" checked> ${escapeHtml(person.name)}</label>`).join('');
  return `<article class="panel focused-form one-off-form"><div class="task-heading"><span>＋</span><div><h2>Jednorázový náklad</h2><p>Zadejte výdaj, který už někdo z domácnosti zaplatil. Automaticky se zařadí do zvoleného vyúčtování.</p></div></div>
    <form method="post" action="/expenses" enctype="multipart/form-data" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <div class="form-grid"><label>Datum úhrady<input type="date" name="occurred_on" value="${new Date().toISOString().slice(0, 10)}" required></label><label>Zaúčtovat do měsíce<input type="month" name="period" value="${escapeHtml(period)}" required><span class="muted small">Výchozí je příští měsíc.</span></label></div>
      <label>Co to bylo<input name="description" required placeholder="Např. čisticí prostředky"></label>
      <div class="form-grid"><label>Částka v Kč<input name="amount" inputmode="decimal" required placeholder="Např. 1250,50"></label><label>Kategorie<select name="category_code">${categoryOptions}</select></label></div>
      <label>Zaplatil/a<select name="paid_by_person_id"><option value="">Neuvádět</option>${personOptions}</select></label>
      <fieldset><legend>Mezi koho náklad rozdělit</legend><div class="checks">${peopleChecks}</div></fieldset>
      <label>Účtenka nebo faktura (volitelně)<input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"></label>
      <input type="hidden" name="entry_type" value="charge">
      <button>Zařadit do vyúčtování</button>
    </form>
  </article>`;
}

function oneOffPage({ config, session, people, categories, period, message, error }) {
  const body = `<section class="page-head"><div><div class="eyebrow">Společný výdaj</div><h1>Přidat náklad</h1><p class="muted">Stačí částka, kdo zaplatil a mezi koho se má rozdělit.</p></div><a class="button secondary" href="/?period=${escapeHtml(period)}">← Zpět na přehled</a></section>
    <div class="narrow-workflow">${oneOffForm({ session, people, categories, period })}</div>`;
  return layout({ title: 'Přidat náklad', body, session, config, period, message, error });
}

function adminPage({ config, session, people, categories, templates, readings, costRules = [], view = 'home', message, error }) {
  const grouped = new Set();
  const groupOptions = people.filter((p) => p.payment_group && !grouped.has(p.payment_group) && grouped.add(p.payment_group))
    .map((p) => {
      const members = people.filter((member) => member.payment_group === p.payment_group);
      return members.length > 1 ? `<option value="group:${escapeHtml(p.payment_group)}">${escapeHtml(members.map((member) => member.name).join(' + '))} (společně)</option>` : '';
  }).join('');
  const personOptions = groupOptions + people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const peopleRows = people.map((p) => `<tr><td><input form="person-${p.id}" name="name" value="${escapeHtml(p.name)}" required></td><td><input form="person-${p.id}" name="weight" type="number" min="0.01" step="0.01" value="${escapeHtml(p.weight)}" required></td><td><label class="check"><input form="person-${p.id}" type="checkbox" name="active" ${p.active ? 'checked' : ''}> aktivní</label></td><td>${p.is_manager ? 'ano' : '—'}</td><td><form id="person-${p.id}" method="post" action="/people/${p.id}"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><button>Uložit</button></form></td></tr>`).join('');
  const readingRows = readings.map((r) => `<tr class="${r.status === 'void' ? 'void' : ''}"><td>${escapeHtml(r.read_on)}</td><td>${r.meter_type === 'electricity' ? 'Elektřina' : 'Plyn'}</td><td>${formatDecimal(r.value)} ${escapeHtml(r.unit)}</td><td>${escapeHtml(r.note || '—')}</td><td>${r.status === 'active' ? `<form method="post" action="/meters/${r.id}/void"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input class="compact" name="reason" placeholder="Důvod" required><button class="danger-button">Storno</button></form>` : 'stornováno'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Žádné odečty.</td></tr>';

  const rules = [['equal', 'Stejně na osobu'], ['area_common', 'Podle pokojů'], ['private_area', 'Podle plochy pokoje'], ['weights', 'Podle vah']];
  const recurringRows = costRules.map((rule) => `<tr class="${rule.active ? '' : 'void'}"><td colspan="4"><form method="post" action="/cost-rules/${escapeHtml(rule.code)}" class="rule-row">
    <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><input name="label" value="${escapeHtml(rule.label)}" required>
    <input name="amount" value="${(rule.amount_halere / 100).toFixed(2)}" inputmode="decimal" required>
    <select name="allocation_rule">${rules.map(([value, label]) => `<option value="${value}" ${rule.allocation_rule === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
    <div class="actions"><button>Uložit</button>${rule.active ? `<button class="danger-button" formaction="/cost-rules/${escapeHtml(rule.code)}/deactivate">Odebrat</button>` : `<button class="secondary" formaction="/cost-rules/${escapeHtml(rule.code)}/activate">Obnovit</button>`}</div>
  </form></td></tr>`).join('');
  const oneOff = oneOffForm({ session, people, categories, period: nextPeriod(currentPeriod()) });
  const payments = `<article class="panel focused-form"><div class="task-heading"><span>✓</span><div><h2>Zapsat přijatou platbu</h2><p>Platba sníží zůstatek vybraného měsíce; nemění samotné náklady.</p></div></div><form method="post" action="/payments" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <label>Osoba<select name="person_id">${personOptions}</select></label>
      <div class="form-grid"><label>Datum<input type="date" name="paid_on" required></label><label>Měsíc, proti kterému platba jde<input type="month" name="period" required></label></div>
      <label>Částka v Kč<input name="amount" inputmode="decimal" required></label><label>Poznámka<input name="note" placeholder="Nájem srpen"></label>
      <button>Potvrdit přijetí platby</button>
    </form></article>`;
  const meters = `<article class="panel focused-form"><div class="task-heading"><span>⌁</span><div><h2>Zapsat odečet</h2><p>Odečty elektřiny a plynu se pořizují každý měsíc k 1. dni.</p></div></div><form method="post" action="/meters" class="stack">
      <input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}">
      <div class="form-grid"><label>Typ<select name="meter_type"><option value="electricity">Elektřina</option><option value="gas">Plyn</option></select></label><label>Datum<input type="date" name="read_on" required></label></div>
      <div class="form-grid"><label>Stav<input name="value" inputmode="decimal" required></label><label>Jednotka<input name="unit" value="kWh" required></label></div>
      <label>Poznámka<input name="note" placeholder="Fotografie uložena v…"></label><button>Uložit odečet</button>
    </form></article><section class="panel"><h2>Historie odečtů</h2><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Typ</th><th>Stav</th><th>Poznámka</th><th></th></tr></thead><tbody>${readingRows}</tbody></table></div></section>`;
  const recurring = `<section class="panel"><div class="panel-head"><div><h2>Pravidelné náklady</h2><p class="muted small">Tyto položky se automaticky objeví v návrhu každého měsíce.</p></div><a class="button secondary" href="/calculator/settings">Pokoje a další nastavení</a></div>
    <div class="table-wrap"><table><thead><tr><th>Název</th><th>Částka</th><th>Rozdělení</th><th></th></tr></thead><tbody>${recurringRows}</tbody></table></div>
    <details class="add-rule"><summary>＋ Přidat pravidelný náklad</summary><form method="post" action="/cost-rules" class="form-grid"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><label>Název<input name="label" required></label><label>Částka v Kč<input name="amount" required></label><label>Rozdělení<select name="allocation_rule">${rules.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><button>Přidat</button></form></details>
  </section>`;
  const residents = `<section class="panel"><div class="panel-head"><div><h2>Obyvatelé</h2><p class="muted small">Běžně není potřeba měnit. Plochy pokojů jsou v nastavení domácnosti.</p></div></div><div class="table-wrap"><table><thead><tr><th>Jméno</th><th>Váha</th><th>Stav</th><th>Správce</th><th></th></tr></thead><tbody>${peopleRows}</tbody></table></div></section>`;
  const home = `<section class="task-grid">
    <a href="/calculator" class="task-card primary-task"><span>1</span><div><strong>Vytvořit měsíční vyúčtování</strong><p>Zkontrolovat pravidelné a jednorázové položky, rozdělení a zaúčtovat měsíc.</p></div></a>
    <a href="/one-off" class="task-card"><span>＋</span><div><strong>Přidat jednorázový náklad</strong><p>Výdaj obyvatele nebo doplatek do dalšího vyúčtování.</p></div></a>
    <a href="/admin?view=payments" class="task-card"><span>✓</span><div><strong>Zapsat přijatou platbu</strong><p>Po přijetí platby na účet aktualizovat zůstatek obyvatele.</p></div></a>
    <a href="/admin?view=meters" class="task-card"><span>⌁</span><div><strong>Zapsat odečet</strong><p>Měsíční stav elektřiny nebo plynu.</p></div></a>
  </section>`;
  const content = ({ home, 'one-off': oneOff, payments, meters, recurring, residents })[view] || home;
  const body = `<section class="page-head"><div><div class="eyebrow">Administrace</div><h1>Co potřebujete udělat?</h1><p class="muted">Vyberte jeden úkol. Zobrazí se pouze údaje, které k němu potřebujete.</p></div></section>
    <nav class="task-nav"><a href="/admin" ${view === 'home' ? 'class="active"' : ''}>Úkoly</a><a href="/admin?view=recurring" ${view === 'recurring' ? 'class="active"' : ''}>Pravidelné náklady</a><a href="/one-off">Jednorázový náklad</a><a href="/admin?view=payments" ${view === 'payments' ? 'class="active"' : ''}>Platba</a><a href="/admin?view=meters" ${view === 'meters' ? 'class="active"' : ''}>Odečet</a><a href="/admin?view=residents" ${view === 'residents' ? 'class="active"' : ''}>Obyvatelé</a></nav>${content}`;
  return layout({ title: 'Správa', body, session, config, message, error });
}

function weekdayOptions(selected) {
  return [['', 'Zatím neznámý'], ['1', 'Pondělí'], ['2', 'Úterý'], ['3', 'Středa'], ['4', 'Čtvrtek'], ['5', 'Pátek'], ['6', 'Sobota'], ['0', 'Neděle']]
    .map(([value, label]) => `<option value="${value}" ${String(selected) === value ? 'selected' : ''}>${label}</option>`).join('');
}

function calculatorPage({ config, session, period, data, message, error }) {
  const allLines = [...data.lines, ...data.adjustments];
  const totalCosts = allLines.reduce((sum, line) => sum + line.amount_halere, 0);
  const header = data.totals.map((person) => `<th>${escapeHtml(person.name.split(' ')[0])}</th>`).join('');
  const rows = allLines.map((line) => `<tr class="${line.allocation_rule === 'adjustment' ? 'adjustment-row' : ''}">
    <td><strong>${escapeHtml(line.label)}</strong><small>${line.category_label ? `${escapeHtml(line.category_label)} · ` : ''}${allocationRuleLabel(line.allocation_rule)}</small></td>
    <td class="number">${formatMoney(line.amount_halere)}</td>
    ${data.totals.map((person) => {
      const amount = line.allocations.find((item) => item.personId === person.id)?.amount || 0;
      return `<td class="number">${formatMoney(amount)}</td>`;
    }).join('')}
  </tr>`).join('');
  const combinedTotals = data.totals.map((person) => ({
    ...person,
    amount_halere: allLines.reduce((sum, line) =>
      sum + (line.allocations.find((item) => item.personId === person.id)?.amount || 0), 0)
  }));
  const totals = `<tr class="total-row"><td>Celkem za měsíc</td><td class="number">${formatMoney(totalCosts)}</td>
    ${combinedTotals.map((person) => `<td class="number">${formatMoney(person.amount_halere)}</td>`).join('')}</tr>`;
  const grouped = [];
  for (const person of combinedTotals) {
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
      <div class="page-actions"><a class="button secondary" href="/admin?view=recurring">Pravidelné náklady</a>
      <form method="get" action="/calculator" class="period-picker"><label>Měsíc<input type="month" name="period" value="${escapeHtml(period)}"></label><button>Zobrazit</button></form></div>
    </section>
    <section class="billing-hero"><div><span>Celkem domácnost</span><strong>${formatMoney(totalCosts)}</strong><small>${data.lines.length} pravidelných + ${data.adjustments.length} jednorázových položek</small></div><div class="payer-grid">${payers}</div></section>
    <section class="panel">
      <div class="panel-head"><div><h2>Kontrola rozdělení</h2><p class="muted small">Každý řádek ukazuje celkový náklad a přesný podíl každého obyvatele.</p></div></div>
      <div class="table-wrap allocation-matrix"><table><thead><tr><th>Náklad</th><th>Celkem</th>${header}</tr></thead><tbody>${rows}${totals}</tbody></table></div>
    </section>
    <section class="panel action-panel">${generation}</section>
    <section class="panel adjustment-guide">
      <div class="panel-head"><div><h2>Mimořádné položky</h2><p class="muted small">Přidávají se k již vytvořenému předpisu; není kvůli nim potřeba celý měsíc rušit.</p></div><a class="button secondary" href="/one-off?period=${escapeHtml(period)}">Přidat položku</a></div>
      <div class="guidance-grid">
        <div><strong>Dodatečný náklad</strong><p>Například oprava nebo doplatek vyúčtování. Zvýší částku k úhradě.</p></div>
        <div><strong>Přeplatek po platbě</strong><p>V přehledu nabídneme jeho převod jako slevu do následujícího měsíce.</p></div>
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
    weights: 'podle vah',
    adjustment: 'jednorázová položka'
  })[rule] || rule;
}

function calculatorSettingsPage({ config, session, period, data, message, error }) {
  const roomInputs = data.rooms.map((room) => `<div class="room-rule">
    <label>Název<input name="room_name_${room.id}" value="${escapeHtml(room.name)}" required></label>
    <label>Délka (m)<input type="number" min=".01" step=".01" name="room_length_${room.id}" value="${escapeHtml(room.length_m)}" required></label>
    <label>Šířka (m)<input type="number" min=".01" step=".01" name="room_width_${room.id}" value="${escapeHtml(room.width_m)}" required></label>
    <div><span>${escapeHtml(room.people_names || 'bez obyvatel')}</span><strong>${formatDecimal(room.area_m2, 2)} m²</strong></div>
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
          <section class="settings-section"><div class="section-heading"><span>2</span><div><h2>Platby</h2><p>Účet pro QR kódy a termín splatnosti.</p></div></div>
            <div class="form-grid"><label>Český IBAN<input name="payment_iban" value="${escapeHtml(data.paymentIban)}" placeholder="CZ6508000000192000145399"></label>
            <label>Den splatnosti<input type="number" min="1" max="28" name="payment_due_day" value="${escapeHtml(data.paymentDueDay)}" required></label></div>
            <p class="muted small">David a Anežka mají jednu společnou platbu. IBAN zůstává jen v této aplikaci.</p>
          </section>
          <details class="settings-section"><summary><span class="section-number">3</span><div><h2>Svoz odpadu</h2><p>Volitelné – nastavíme, až vypozorujete pravidelnost.</p></div></summary>
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

function auditLabel(entry) {
  const labels = {
    'create:expense': 'Přidán náklad',
    'void:expense': 'Náklad stornován',
    'create:expense_attachment': 'Přidána příloha',
    'create:payment': 'Zapsána platba',
    'create:group_payment': 'Zapsána společná platba',
    'void:payment': 'Platba stornována',
    'create:cost_rule': 'Přidán pravidelný náklad',
    'update:cost_rule': 'Upraven pravidelný náklad',
    'deactivate:cost_rule': 'Odebrán pravidelný náklad',
    'activate:cost_rule': 'Obnoven pravidelný náklad',
    'generate:calculator_month': 'Vytvořeno vyúčtování',
    'reopen:calculator_month': 'Vyúčtování vráceno k úpravě',
    'confirm:statement': 'Vyúčtování potvrzeno',
    'transfer_credit:person': 'Přeplatek převeden',
    'create:meter_reading': 'Přidán odečet',
    'void:meter_reading': 'Odečet stornován',
    'update:person': 'Upraven obyvatel'
  };
  return labels[`${entry.action}:${entry.entity_type}`] || 'Změna v evidenci';
}

function auditSummary(entry, details) {
  if (entry.entity_type === 'expense' && details.description) return details.description;
  if (entry.entity_type === 'cost_rule') return details.label || details.code || 'Pravidelný náklad';
  if (entry.entity_type === 'statement') return details.period || 'Měsíční vyúčtování';
  if (entry.entity_type === 'calculator_month') return details.period || 'Měsíční vyúčtování';
  if (entry.action === 'transfer_credit') return `${details.sourcePeriod || ''} → ${details.targetPeriod || ''}`;
  if (entry.entity_type === 'person') return details.name || `Obyvatel #${entry.entity_id}`;
  if (entry.entity_type === 'meter_reading') return details.read_on || 'Odečet';
  return entry.entity_id ? `Záznam #${entry.entity_id}` : 'Systémový záznam';
}

function auditPage({ config, session, entries }) {
  const rows = entries.map((entry) => {
    let details = {};
    try { details = JSON.parse(entry.details_json || '{}'); } catch {}
    return `<article class="audit-entry"><div class="audit-time">${escapeHtml(entry.created_at)}</div><div class="audit-copy"><strong>${escapeHtml(auditLabel(entry))}</strong><span>${escapeHtml(auditSummary(entry, details))}</span></div>
      <details><summary>Detail</summary><code>${escapeHtml(JSON.stringify(details, null, 2))}</code></details></article>`;
  }).join('') || '<p class="empty">Zatím tu nejsou žádné změny.</p>';
  return layout({ title: 'Audit', session, config, body: `<section class="page-head"><div><div class="eyebrow">Historie změn</div><h1>Audit</h1><p class="muted">Na první pohled je vidět, co se stalo. Technický detail otevřete jen při řešení konkrétní změny.</p></div></section><section class="panel audit-list">${rows}</section>` });
}

function printPage({ config, period, data }) {
  const summary = data.people.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${formatMoney(p.due_halere)}</td><td>${formatMoney(p.paid_halere)}</td><td>${formatMoney(p.balance_halere)}</td></tr>`).join('');
  const rows = data.expenses.filter((e) => e.status === 'active').map((e) => `<tr><td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.allocation_text)}</td><td>${formatMoney(e.amount_halere)}</td></tr>`).join('');
  return layout({ print: true, title: `Přehled ${period}`, config, body: `<section class="print-head"><div><h1>${escapeHtml(config.householdName)}</h1><p>Měsíční rozúčtování · ${escapeHtml(periodLabel(period))}</p></div><button onclick="window.print()">Vytisknout / uložit PDF</button></section><h2>Souhrn osob</h2><table><thead><tr><th>Osoba</th><th>Předepsáno</th><th>Zaplaceno</th><th>Zbývá</th></tr></thead><tbody>${summary}</tbody></table><h2>Položky</h2><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Popis</th><th>Rozdělení</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table><p class="print-total">Celkové náklady: ${formatMoney(data.totalHalere)}</p>` });
}

module.exports = {
  layout, loginPage, dashboardPage, oneOffPage, adminPage, auditPage, printPage,
  calculatorPage, calculatorSettingsPage
};
