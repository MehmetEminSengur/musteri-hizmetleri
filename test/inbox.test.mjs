import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/db.mjs';
import { ingest, buildHistory, isOurAccount } from '../src/inbox.mjs';
import { waMsg } from './helpers.mjs';

test('aynı mesaj iki kez gelirse bir kez kaydedilir', () => {
  const db = openDb(':memory:');
  assert.ok(ingest(db, waMsg()));
  assert.equal(ingest(db, waMsg()), null);
  assert.equal(db.prepare('SELECT count(*) n FROM messages').get().n, 1);
});

test('yalnız bu mağazanın hesaplarına gelen mesajlar işlenir', () => {
  assert.ok(isOurAccount({ whatsapp: '111' }, waMsg()));
  assert.ok(!isOurAccount({ whatsapp: '999' }, waMsg()));
  assert.ok(!isOurAccount({ whatsapp: '111', instagram: null }, { channel: 'instagram', accountId: 'null' }));
});

test('ardışık müşteri mesajları birleşir; son mesaj bizdense cevaplanacak bir şey yoktur', () => {
  const db = openDb(':memory:');
  const r = ingest(db, waMsg({ text: 'merhaba', id: 'a' }));
  ingest(db, waMsg({ text: 'kase var mı', id: 'b' }));
  assert.deepEqual(buildHistory(db, r.conversationId), [{ role: 'user', content: 'merhaba\nkase var mı' }]);
  db.prepare("INSERT INTO messages(conversation_id, channel, author, text, sent_at) VALUES (?, 'whatsapp', 'ai', 'Var.', ?)").run(r.conversationId, new Date().toISOString());
  assert.deepEqual(buildHistory(db, r.conversationId), []);
});

test('bizim mesajımızla aynı saniyede gelen müşteri cevabı cevapsız kalmaz (sıra geliş sırasıdır)', () => {
  const db = openDb(':memory:');
  const r = ingest(db, waMsg({ text: 'fiyat?', id: 'a', at: '2026-11-19T11:00:00.000Z' }));
  db.prepare("INSERT INTO messages(conversation_id, channel, author, text, sent_at) VALUES (?, 'whatsapp', 'ai', '141,90 TL', '2026-11-19T11:00:00.900Z')").run(r.conversationId);
  ingest(db, waMsg({ text: 'tamam alıyorum', id: 'b', at: '2026-11-19T11:00:00.000Z' }));
  assert.deepEqual(buildHistory(db, r.conversationId).at(-1), { role: 'user', content: 'tamam alıyorum' });
});

test('WhatsApp müşterisi doğrulanmış, aynı numara tek müşteri', () => {
  const db = openDb(':memory:');
  ingest(db, waMsg());
  assert.equal(db.prepare('SELECT verified FROM identities').get().verified, 1);
  assert.equal(db.prepare('SELECT phone FROM customers').get().phone, '905551112233');
});
