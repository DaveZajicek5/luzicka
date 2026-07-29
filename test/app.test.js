'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/app');
const { splitWeighted } = require('../src/utils');

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

test('viewer neotevře administraci, admin přidá položku a export ji obsahuje', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());

  const viewer = await login(base, 'viewer-pass');
  assert.equal(viewer.response.status, 303);
  const denied = await fetch(`${base}/admin`, { headers: { cookie: viewer.cookie }, redirect: 'manual' });
  assert.equal(denied.status, 403);
  const services = await fetch(`${base}/services`, { headers: { cookie: viewer.cookie } });
  const servicesHtml = await services.text();
  assert.equal(services.status, 200);
  assert.match(servicesHtml, /Všechno na jednom místě/);
  assert.match(servicesHtml, /luzicka\.tailef7327\.ts\.net:5055/);
  assert.match(servicesHtml, /Sonarr/);
  assert.match(servicesHtml, /Prowlarr/);

  const admin = await login(base, 'admin-pass');
  const adminResponse = await fetch(`${base}/admin`, { headers: { cookie: admin.cookie } });
  const html = await adminResponse.text();
  const csrf = csrfFrom(html);
  assert.ok(csrf);

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

  const dashboard = await fetch(`${base}/?period=2026-07`, { headers: { cookie: viewer.cookie } });
  const dashboardHtml = await dashboard.text();
  assert.match(dashboardHtml, /Internet červenec/);
  assert.match(dashboardHtml, /800,00/);

  const csv = await fetch(`${base}/export/month.csv?period=2026-07`, { headers: { cookie: viewer.cookie } });
  const csvText = await csv.text();
  assert.match(csvText, /Internet červenec/);
  assert.match(csvText, /200,00/);
});
