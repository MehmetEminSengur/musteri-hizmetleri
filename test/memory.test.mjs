// Müşteri hafızası: notlar, profil, kanallar arası tanıma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingest } from '../src/inbox.mjs';
import { generateDraft } from '../src/service.mjs';
import { addNote, notesOf, buildProfile, MAX_NOTES } from '../src/customers.mjs';
import { makeCtx, scriptedEngine, tool, reply, waMsg, igMsg } from './helpers.mjs';

const convRow = (db, id) => db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);

test('AI notu kaydeder; sonraki ziyarette not, ad ve son sipariş isteme girer', async () => {
  const ctx = makeCtx({ engine: scriptedEngine(tool('musteri_notu_kaydet', { not: 'Kafe işletiyor, ayda 10 paket kase alıyor' }), reply('141,90 TL')) });
  const id = ingest(ctx.db, waMsg({ text: 'Kafem için ayda 10 paket kase alıyorum' })).conversationId;
  await generateDraft(ctx, id);
  assert.deepEqual(notesOf(ctx.db, convRow(ctx.db, id).customer_id).map((n) => n.text), ['Kafe işletiyor, ayda 10 paket kase alıyor']);

  ingest(ctx.db, waMsg({ id: 'b', text: 'yine kase lazım' }));
  ctx.engine = scriptedEngine(reply('Merhaba Ayşe Hanım'));
  await generateDraft(ctx, id);
  const p = ctx.engine.prompts[0];
  assert.match(p, /Kafe işletiyor/);
  assert.match(p, /Adı: Ayşe/);
  assert.match(p, /#1042/);
});

test('notlar tekrar etmez, kısalır; sınırda en eski AI notu silinir, operatör notu kalır', () => {
  const ctx = makeCtx();
  const id = ingest(ctx.db, waMsg()).conversationId;
  const cid = convRow(ctx.db, id).customer_id;
  assert.equal(addNote(ctx.db, cid, '  Kafe   işletiyor ', 'ai').text, 'Kafe işletiyor');
  assert.equal(addNote(ctx.db, cid, 'KAFE İŞLETİYOR', 'ai'), null);
  assert.equal(addNote(ctx.db, cid, 'x'.repeat(1000), 'human').text.length, 300);
  for (let i = 0; i < MAX_NOTES + 5; i++) addNote(ctx.db, cid, `not ${i}`, 'ai');
  const notes = notesOf(ctx.db, cid);
  assert.equal(notes.length, MAX_NOTES);
  assert.ok(notes.some((n) => n.source === 'human'));
});

test('doğrulanmamış Instagram müşterisi sipariş göremez', async () => {
  const ctx = makeCtx({ engine: scriptedEngine(tool('musteri_siparisleri', {}), reply('Sipariş numaranızı alabilir miyim?')) });
  const id = ingest(ctx.db, igMsg({ text: 'siparişim nerede?' })).conversationId;
  assert.match(await buildProfile(ctx.db, ctx.commerce, convRow(ctx.db, id)), /doğrulanmadı/);
  await generateDraft(ctx, id);
  assert.match(ctx.engine.prompts[1], /kimliği bu kanalda doğrulanmadı/);
  assert.doesNotMatch(ctx.engine.prompts[1], /#1042/);
});

test('yanlış telefon: sipariş yok ile aynı cevap, birleştirme yok', async () => {
  const ctx = makeCtx({ engine: scriptedEngine(
    tool('siparis_sorgula', { siparis_no: '1042', telefon_veya_eposta: '0555 999 99 99' }),
    tool('siparis_sorgula', { siparis_no: '9999', telefon_veya_eposta: '0555 111 22 33' }),
    reply('Bulamadım.')) });
  ingest(ctx.db, waMsg());
  const id = ingest(ctx.db, igMsg()).conversationId;
  await generateDraft(ctx, id);
  const p = ctx.engine.prompts.at(-1);
  const results = [...p.matchAll(/Sonuç: (.*)/g)].map((m) => m[1]);
  assert.equal(results[0], results[1]);
  assert.equal(ctx.db.prepare('SELECT count(*) n FROM customers').get().n, 2);
});

test('Instagram müşterisi siparişle doğrulanınca WhatsApp kaydıyla tek müşteri olur', async () => {
  const ctx = makeCtx({ engine: scriptedEngine(tool('siparis_sorgula', { siparis_no: '#1042', telefon_veya_eposta: '0555 111 22 33' }), reply('Siparişiniz kargoda.')) });
  const waConv = ingest(ctx.db, waMsg({ text: 'kase fiyatı?' })).conversationId;
  const waCustomer = convRow(ctx.db, waConv).customer_id;
  addNote(ctx.db, waCustomer, 'Kafe işletiyor', 'human');
  const igConv = ingest(ctx.db, igMsg({ text: 'siparişim? no 1042 tel 05551112233' })).conversationId;
  await generateDraft(ctx, igConv);

  assert.equal(convRow(ctx.db, igConv).customer_id, waCustomer);
  assert.equal(ctx.db.prepare('SELECT count(*) n FROM customers').get().n, 1);
  assert.equal(ctx.db.prepare('SELECT min(verified) v FROM identities').get().v, 1);

  ingest(ctx.db, igMsg({ id: 'mid.2', text: 'bir de poşet?' }));
  ctx.engine = scriptedEngine(reply('Tabii'));
  await generateDraft(ctx, igConv);
  const p = ctx.engine.prompts[0];
  assert.match(p, /Kafe işletiyor/);
  assert.match(p, /#1042/);
  assert.match(p, /\[WhatsApp .*\] Müşteri: kase fiyatı\?/);
  assert.match(p, /kimliği doğrulanmış/);
});
