// Uçtan uca: webhook → kayıt → taslak → (otomatik ya da panelden) gönderim. Panel güvenliği.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRuntime } from '../src/server/runtime.mjs';
import { webhookHandler, panelHandler } from '../src/server/http.mjs';
import { makeCtx, makeConfig, scriptedEngine, tool, reply, fakeSender, sign, waPayload, WA_ID } from './helpers.mjs';

async function start(mode = 'approval', steps = []) {
  const ctx = makeCtx({ config: makeConfig({ mode }), engine: scriptedEngine(...steps) });
  const sender = fakeSender();
  const runtime = createRuntime(ctx, { accounts: { whatsapp: WA_ID, messenger: '333', instagram: '222' }, sender });
  const servers = [];
  const listen = (h) => new Promise((r) => { const s = http.createServer(h).listen(0, '127.0.0.1', () => { servers.push(s); r(s.address().port); }); });
  const hookPort = await listen(webhookHandler({ config: ctx.config, verifyToken: 'vt', runtime, log: () => {} }));
  let panelPort;
  panelPort = await listen((req, res) => handler(req, res));
  const handler = panelHandler(ctx, { runtime, panelToken: 'pt', port: panelPort });
  const hook = (path, init) => fetch(`http://127.0.0.1:${hookPort}${path}`, init);
  const panel = (path, { body, token = 'pt', host } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port: panelPort, path, method: body ? 'POST' : 'GET', headers: { host: host || `127.0.0.1:${panelPort}`, 'x-panel-token': token, 'content-type': 'application/json' } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(t); } catch { return t; } })() }));
    });
    req.on('error', reject);
    req.end(data);
  });
  const post = (payload) => { const b = JSON.stringify(payload); return hook('/webhook', { method: 'POST', body: b, headers: { 'x-hub-signature-256': sign(b), 'content-type': 'application/json' } }); };
  return { ctx, sender, runtime, hook, panel, post, close: () => servers.forEach((s) => s.close()) };
}

test('Meta doğrulaması ve imzasız istek', async () => {
  const s = await start();
  try {
    const ok = await s.hook('/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=42');
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '42');
    assert.equal((await s.hook('/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=42')).status, 403);
    assert.equal((await s.hook('/webhook', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': 'sha256=00' } })).status, 401);
  } finally { s.close(); }
});

test('onaylı mod: taslak panelde bekler, Gönder ile bir kez gider', async () => {
  const s = await start('approval', [tool('urun_ara', { sorgu: 'kase' }), reply('1 paket = 50 kase + 50 kapak, 141,90 TL')]);
  try {
    assert.equal((await s.post(waPayload())).status, 200);
    assert.equal((await s.post(waPayload())).status, 200); // aynı webhook tekrar
    await s.runtime.idle();
    assert.equal(s.sender.sent.length, 0);
    const { json } = await s.panel('/api/ozet');
    assert.equal(json.taslaklar.length, 1);
    const id = json.taslaklar[0].draft_id;
    const r = await s.panel(`/api/taslak/${id}/onayla`, { body: {} });
    assert.equal(r.json.gonderim, 'sent');
    assert.equal((await s.panel(`/api/taslak/${id}/onayla`, { body: {} })).status, 409);
    assert.equal(s.sender.sent.length, 1);
    assert.deepEqual(s.sender.sent[0].target, { channel: 'whatsapp', userId: '905551112233' });
    const conv = await s.panel(`/api/konusma/${json.taslaklar[0].conversation_id}`);
    assert.deepEqual(conv.json.messages.map((m) => m.author), ['customer', 'ai']);
  } finally { s.close(); }
});

test('otomatik mod: kontrolden geçen cevap hemen gider', async () => {
  const s = await start('auto', [tool('urun_ara', { sorgu: 'kase' }), reply('1 paket = 50 kase + 50 kapak, 141,90 TL. https://ornek-magaza.com/products/kase')]);
  try {
    await s.post(waPayload());
    await s.runtime.idle();
    assert.equal(s.sender.sent.length, 1);
    assert.match(s.sender.sent[0].text, /141,90 TL/);
  } finally { s.close(); }
});

test('otomatik mod: uydurma fiyatlı cevap gitmez, nedeniyle onaya düşer', async () => {
  const s = await start('auto', [reply('Size özel 99,90 TL!')]);
  try {
    await s.post(waPayload());
    await s.runtime.idle();
    assert.equal(s.sender.sent.length, 0);
    const conv = await s.panel('/api/konusma/1');
    assert.match(conv.json.drafts[0].hold_reason, /99,90 TL/);
  } finally { s.close(); }
});

test('otomatik mod: devirde bekleme mesajı gider, konuşma insanda kalır', async () => {
  const s = await start('auto', [tool('insana_devret', { kategori: 'sikayet_iade', neden: 'kırık ürün' }), reply('Talebinizi ekibimize ilettim, en kısa sürede dönüş yapacağız.')]);
  try {
    await s.post(waPayload({ text: 'ürün kırık geldi' }));
    await s.runtime.idle();
    assert.equal(s.sender.sent.length, 1);
    const conv = await s.panel('/api/konusma/1');
    assert.equal(conv.json.status, 'human');
  } finally { s.close(); }
});

test('başka hesaba gelen mesaj işlenmez', async () => {
  const s = await start();
  try {
    const p = waPayload();
    p.entry[0].changes[0].value.metadata.phone_number_id = 'baska';
    await s.post(p);
    await s.runtime.idle();
    assert.equal((await s.panel('/api/ozet')).json.taslaklar.length, 0);
  } finally { s.close(); }
});

test('panel: yanlış anahtar ve yabancı Host reddedilir', async () => {
  const s = await start();
  try {
    assert.equal((await s.panel('/api/ozet', { token: 'yanlis' })).status, 401);
    assert.equal((await s.panel('/api/ozet', { host: 'kotu-site.com' })).status, 403);
    const page = await s.panel('/', { token: '' });
    assert.equal(page.status, 200);
  } finally { s.close(); }
});

test('panel: devral/bırak, not, operatör mesajı tek sefer', async () => {
  const s = await start('approval', [reply('cevap')]);
  try {
    await s.post(waPayload());
    await s.runtime.idle();
    assert.equal((await s.panel('/api/konusma/1/devral', { body: {} })).status, 200);
    const c = await s.panel('/api/konusma/1');
    assert.equal(c.json.status, 'human');
    await s.panel(`/api/musteri/${c.json.customer.id}/not`, { body: { text: 'Kafe işletiyor' } });
    assert.equal((await s.panel('/api/konusma/1')).json.customer.notes[0].text, 'Kafe işletiyor');
    for (let i = 0; i < 2; i++) await s.panel('/api/konusma/1/gonder', { body: { text: 'Merhaba', requestKey: 'k1' } });
    assert.equal(s.sender.sent.length, 1);
  } finally { s.close(); }
});
