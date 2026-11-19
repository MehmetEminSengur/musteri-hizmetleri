// Otomatik gönderim kapıları ve idempotent gönderim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoSendIssues } from '../src/agent/guards.mjs';
import { ingest } from '../src/inbox.mjs';
import { enqueue, send, recoverOutbox, resolveUnknown } from '../src/outbox.mjs';
import { SendError, SendUnknown } from '../src/meta/graph.mjs';
import { openDb } from '../src/db/db.mjs';
import { fakeSender, waMsg } from './helpers.mjs';

const site = { publicUrl: 'https://ornek-magaza.com', storeDomain: 'ornek.myshopify.com' };
const evidence = JSON.stringify([{ price: '141,90 TL', url: 'https://ornek-magaza.com/products/kase' }]);

test('mağaza verisindeki fiyat ve paket katları geçer', () => {
  assert.deepEqual(autoSendIssues({ ...site, evidence, text: '1 paket 141,90 TL, 3 paket 425,70 TL. https://www.ornek-magaza.com/products/kase.' }), []);
});

test('uydurma fiyat, yabancı link, anahtar/dosya yolu ve yer tutucu kapıda kalır', () => {
  const issues = autoSendIssues({ ...site, evidence, text: 'Size özel 99,90 TL! https://kotu-site.com ~/.codex/auth.json {ODEME_LINKI}' });
  assert.equal(issues.length, 4);
  assert.ok(issues.some((i) => /99,90 TL/.test(i)));
  assert.ok(issues.some((i) => /kotu-site/.test(i)));
  assert.ok(issues.some((i) => /anahtar, dosya yolu/.test(i)));
  assert.ok(issues.some((i) => /yer tutucu/.test(i)));
  assert.ok(autoSendIssues({ ...site, evidence, text: 'Token: EAAB' + 'x'.repeat(30) }).length);
  assert.ok(autoSendIssues({ ...site, evidence, text: 'x'.repeat(1500) }).length);
  assert.ok(autoSendIssues({ ...site, evidence, text: '' }).length);
});

test('ödeme isteği varsa yer tutucu geçer', () => {
  assert.deepEqual(autoSendIssues({ ...site, evidence, text: 'Ödeme: {ODEME_LINKI}', actions: [{ type: 'payment_link' }] }), []);
});

const setup = () => {
  const db = openDb(':memory:');
  const { conversationId } = ingest(db, waMsg());
  return { db, conversationId };
};

test('gönderim bir kez yapılır, aynı anahtar ikinci kez kuyruğa girmez', async () => {
  const { db, conversationId } = setup();
  const item = enqueue(db, { conversationId, text: 'merhaba', author: 'human', key: 'k' });
  assert.equal(enqueue(db, { conversationId, text: 'merhaba', author: 'human', key: 'k' }).id, item.id);
  const s = fakeSender();
  assert.equal((await send(db, item.id, s)).state, 'sent');
  assert.equal((await send(db, item.id, s)).state, 'sent');
  assert.equal(s.sent.length, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM messages WHERE author = 'human'").get().n, 1);
});

test('belirsiz gönderim asla otomatik tekrar gönderilmez', async () => {
  const { db, conversationId } = setup();
  const item = enqueue(db, { conversationId, text: 'merhaba', author: 'ai', key: 'k' });
  const s = fakeSender(new SendUnknown('zaman aşımı'));
  assert.equal((await send(db, item.id, s)).state, 'unknown');
  s.error = null;
  assert.equal((await send(db, item.id, s)).state, 'unknown');
  assert.equal(s.sent.length, 1);
  resolveUnknown(db, item.id, true);
  assert.equal(db.prepare('SELECT state FROM outbox WHERE id = ?').get(item.id).state, 'sent');
});

test('kesin ret "failed" olur', async () => {
  const { db, conversationId } = setup();
  const item = enqueue(db, { conversationId, text: 'x', author: 'ai', key: 'k' });
  assert.equal((await send(db, item.id, fakeSender(new SendError('400')))).state, 'failed');
});

test('WhatsApp 24 saat penceresi kapalıysa gönderilmez', async () => {
  const { db, conversationId } = setup();
  db.prepare('UPDATE conversations SET last_inbound_at = ?').run(new Date(Date.now() - 25 * 3600_000).toISOString());
  const item = enqueue(db, { conversationId, text: 'x', author: 'ai', key: 'k' });
  const s = fakeSender();
  assert.equal((await send(db, item.id, s)).state, 'blocked');
  assert.equal(s.sent.length, 0);
});

test('gönderim sırasında kapanan program açılışta belirsiz sayar', () => {
  const { db, conversationId } = setup();
  const item = enqueue(db, { conversationId, text: 'x', author: 'ai', key: 'k' });
  db.prepare("UPDATE outbox SET state = 'sending' WHERE id = ?").run(item.id);
  assert.equal(recoverOutbox(db), 1);
  assert.equal(db.prepare('SELECT state FROM outbox WHERE id = ?').get(item.id).state, 'unknown');
});
