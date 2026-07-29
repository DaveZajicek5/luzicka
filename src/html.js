'use strict';

const { escapeHtml, formatMoney, formatDecimal, periodLabel } = require('./utils');

function layout({ title, body, session, config, period, message, error, print = false }) {
  const nav = session && !print ? `
    <header class="topbar">
      <a class="brand" href="/?period=${escapeHtml(period || '')}">${escapeHtml(config.householdName)}</a>
      <nav>
        <a href="/?period=${escapeHtml(period || '')}">Přehled</a>
        <a href="/services">Služby</a>
        ${session.role === 'admin' ? '<a href="/admin">Správa</a><a href="/audit">Audit</a>' : ''}
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
  <link rel="stylesheet" href="/app.css?v=20260729-1">
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

function servicesPage({ config, session }) {
  const host = 'https://luzicka.tailef7327.ts.net';
  const groups = [
    {
      number: '01', title: 'Nejčastěji používané', description: 'Věci, kvůli kterým sem obvykle jdete.',
      primary: true,
      items: [
        ['NÁ', 'Nájmy a domácnost', '/', 'Vyúčtování, náklady, platby a QR kódy.', 'Lužická'],
        ['SE', 'Seerr', `${host}:5055`, 'Najít a přidat film nebo seriál do knihovny.', 'Požadavky na média'],
        ['QB', 'qBittorrent', `${host}:8080`, 'Průběh aktuálních stahování a ruční správa.', 'Stahování']
      ]
    },
    {
      number: '02', title: 'Média a automatizace', description: 'Detailní správa knihovny a stahování.',
      items: [
        ['SO', 'Sonarr', `${host}:8989`, 'Seriály, epizody a jejich automatizace.', 'Seriály'],
        ['RA', 'Radarr', `${host}:7878`, 'Filmy, kvalita a automatické vyhledávání.', 'Filmy'],
        ['BA', 'Bazarr', `${host}:6767`, 'Titulky k filmům a seriálům.', 'Titulky'],
        ['MA', 'Maintainerr', `${host}:6246`, 'Úklid zhlédnutých a nepotřebných médií.', 'Údržba knihovny']
      ]
    },
    {
      number: '03', title: 'Technická správa', description: 'Nástroje, které běžně není potřeba otevírat.',
      compact: true,
      items: [
        ['PR', 'Prowlarr', `${host}:9696`, 'Zdroje vyhledávání pro Sonarr a Radarr.', 'Indexery']
      ]
    }
  ];
  const cards = (items) => items.map(([initials, name, href, description, meta]) =>
    `<a class="service-card" href="${escapeHtml(href)}"${href === '/' ? '' : ' target="_blank" rel="noreferrer"'}>
      <span class="service-icon" aria-hidden="true">${escapeHtml(initials)}</span>
      <span class="service-copy"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(description)}</span><small>${escapeHtml(meta)}</small></span>
      <span class="service-arrow" aria-hidden="true">↗</span>
    </a>`).join('');
  const sections = groups.map((group) => `<section class="service-section${group.compact ? ' compact-service-section' : ''}">
    <div class="service-section-head"><div><span>${group.number}</span><h2>${escapeHtml(group.title)}</h2></div><p>${escapeHtml(group.description)}</p></div>
    <div class="service-grid${group.primary ? ' primary-services' : ''}">${cards(group.items)}</div>
  </section>`).join('');
  return layout({
    title: 'Služby', session, config,
    body: `<section class="services-hero">
      <div><div class="eyebrow">Domácí server</div><h1>Všechno na jednom místě</h1>
        <p>Rychlý přístup ke službám na serveru Lužická. Odkazy fungují po připojení k našemu Tailnetu.</p></div>
      <div class="tailnet-status"><span aria-hidden="true"></span><div><strong>Soukromá síť</strong><small>luzicka · Tailscale</small></div></div>
    </section>
    ${sections}
    <p class="services-footnote">Odkaz se neotevře? Nejdřív zkontrolujte, že je na zařízení zapnutý Tailscale.</p>`
  });
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

function personCards(people) {
  return people.map((person) => {
    const cls = person.balance_halere > 0 ? 'owes' : person.balance_halere < 0 ? 'credit' : 'settled';
    const label = person.balance_halere > 0 ? 'Zbývá doplatit' : person.balance_halere < 0 ? 'Přeplatek' : 'Vyrovnáno';
    return `<article class="metric-card ${cls}">
      <div class="metric-name">${escapeHtml(person.name)}${person.is_manager ? ' <span class="tag">správce</span>' : ''}</div>
      <div class="metric-value">${formatMoney(Math.abs(person.balance_halere))}</div>
      <div class="metric-label">${label}</div>
      <dl><div><dt>Předepsáno</dt><dd>${formatMoney(person.due_halere)}</dd></div><div><dt>Zaplaceno</dt><dd>${formatMoney(person.paid_halere)}</dd></div></dl>
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
    <section class="metrics">${personCards(data.people)}</section>
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

function auditPage({ config, session, entries }) {
  const rows = entries.map((e) => `<tr><td>${escapeHtml(e.created_at)}</td><td>${escapeHtml(e.action)}</td><td>${escapeHtml(e.entity_type)}${e.entity_id ? ` #${e.entity_id}` : ''}</td><td><code>${escapeHtml(e.details_json)}</code></td></tr>`).join('');
  return layout({ title: 'Audit', session, config, body: `<section class="page-head"><div><div class="eyebrow">Transparentnost</div><h1>Auditní stopa</h1><p class="muted">Posledních 500 administrátorských operací.</p></div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>Čas</th><th>Akce</th><th>Entita</th><th>Detaily</th></tr></thead><tbody>${rows}</tbody></table></div></section>` });
}

function printPage({ config, period, data }) {
  const summary = data.people.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${formatMoney(p.due_halere)}</td><td>${formatMoney(p.paid_halere)}</td><td>${formatMoney(p.balance_halere)}</td></tr>`).join('');
  const rows = data.expenses.filter((e) => e.status === 'active').map((e) => `<tr><td>${escapeHtml(e.occurred_on)}</td><td>${escapeHtml(e.category_label)}</td><td>${escapeHtml(e.description)}</td><td>${escapeHtml(e.allocation_text)}</td><td>${formatMoney(e.amount_halere)}</td></tr>`).join('');
  return layout({ print: true, title: `Přehled ${period}`, config, body: `<section class="print-head"><div><h1>${escapeHtml(config.householdName)}</h1><p>Měsíční rozúčtování · ${escapeHtml(periodLabel(period))}</p></div><button onclick="window.print()">Vytisknout / uložit PDF</button></section><h2>Souhrn osob</h2><table><thead><tr><th>Osoba</th><th>Předepsáno</th><th>Zaplaceno</th><th>Zbývá</th></tr></thead><tbody>${summary}</tbody></table><h2>Položky</h2><table><thead><tr><th>Datum</th><th>Kategorie</th><th>Popis</th><th>Rozdělení</th><th>Celkem</th></tr></thead><tbody>${rows}</tbody></table><p class="print-total">Celkové náklady: ${formatMoney(data.totalHalere)}</p>` });
}

module.exports = { layout, loginPage, servicesPage, dashboardPage, adminPage, auditPage, printPage };
